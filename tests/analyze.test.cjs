const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Load the route with only the AI boundary replaced. Zod and NextResponse
// remain real, so tests exercise the request/response and validation contract.
function loadRoute(generateText, apiKey = 'test-server-key', fetch, reviewGenerateText) {
  const logs = []
  const cache = new Map()
  function load(filename) {
    filename = path.resolve(filename)
    if (cache.has(filename)) return cache.get(filename)
    const module = { exports: {} }
    cache.set(filename, module.exports)
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const localRequire = id => {
      if (id === 'ai') return { ...require('ai'), generateText: async options => {
        if (options.system.startsWith('You are a strict factual editor')) {
          if (reviewGenerateText) return reviewGenerateText(options)
          if (fetch) return require('ai').generateText(options)
          const { draft, resume } = JSON.parse(options.prompt)
          return { output: passingReview(draft, resume) }
        }
        return (generateText ?? require('ai').generateText)(options)
      } }
      if (id === '@ai-sdk/google' && fetch) {
        const google = require('@ai-sdk/google')
        return { ...google, createGoogle: options => google.createGoogle({ ...options, fetch }) }
      }
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id + '.ts'))
      return require(id)
    }
    vm.runInThisContext('(function(require,module,exports,console,process){' + code + '\n})', { filename })(
      localRequire, module, module.exports, { error: (...args) => logs.push(args) },
      { env: { ...process.env, GOOGLE_GENERATIVE_AI_API_KEY: apiKey } },
    )
    return module.exports
  }
  return { ...load('app/api/analyze/route.ts'), logs }
}
function passingReview(draft, resume) {
  const citations = [{ source: 'resume', answerIndex: null, excerpt: resume }]
  return { suggestions: draft.suggestions.map((_, index) => ({ index, supported: true, citations })),
    summarySupported: true, summaryCitations: citations, requirementsConsistent: true }
}
const input = { resume: 'Synthetic candidate: wrote Python scripts.', job: 'Python developer: build automation.' }
const validOutput = {
  role: 'Python developer', company: null, assessment: 'Python is documented.',
  requirements: [{ requirement: 'Python', priority: 'Required', status: 'Supported', evidence: 'wrote Python scripts', explanation: 'Direct evidence.' }],
  suggestions: [], questions: [], summary: 'Developer with Python scripting experience.',
}
function request(body) {
  return new Request('http://localhost/api/analyze', { method: 'POST', body: JSON.stringify(body) })
}

test('rejects malformed, null, blank, oversized, and invalid clarification inputs before calling AI', async () => {
  const route = loadRoute(async () => { assert.fail('AI must not be called') })
  for (const body of [null, {}, { ...input, resume: ' ' }, { ...input, job: 'x'.repeat(16001) },
    { ...input, answers: [4] }, { ...input, answers: ['x'.repeat(2001)] }, { ...input, answers: Array(5).fill('') }]) {
    assert.equal((await route.POST(request(body))).status, 400)
  }
  const badJson = new Request('http://localhost/api/analyze', { method: 'POST', body: '{' })
  assert.equal((await route.POST(badJson)).status, 400)
})

test('custom inputs and clarifications reach AI; validated result is explicitly live', async () => {
  const route = loadRoute(async options => {
    assert.ok(options.prompt.includes(input.resume))
    assert.ok(options.prompt.includes(input.job))
    assert.ok(options.prompt.includes('I also use SQL.'))
    assert.equal(options.model.provider, 'google.generative-ai')
    assert.equal(options.model.modelId, 'gemini-3.1-flash-lite')
    assert.equal(options.maxRetries, 0)
    assert.ok(options.output)
    assert.ok(options.abortSignal)
    return { output: validOutput }
  })
  const response = await route.POST(request({ ...input, answers: ['I also use SQL.'] }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ...validOutput, mode: 'live' })
  assert.deepEqual(route.logs, [])
})

test('Gemini auth, access, model ID, quota, timeout, and structured-output errors are actionable and private', async () => {
  const cases = [
    [{ statusCode: 401 }, 503, 'GEMINI_AUTH'],
    [{ statusCode: 400, data: { error: { details: [{ reason: 'API_KEY_INVALID' }] } } }, 503, 'GEMINI_AUTH'],
    [{ statusCode: 400, data: { error: { details: [{ reason: 'API_KEY_EXPIRED' }] } } }, 503, 'GEMINI_AUTH'],
    [{ statusCode: 403 }, 503, 'GEMINI_ACCESS'],
    [{ statusCode: 404 }, 503, 'MODEL_UNAVAILABLE'],
    [{ name: 'AI_RetryError', lastError: { statusCode: 429 } }, 429, 'GEMINI_QUOTA_EXCEEDED'],
    [{ statusCode: 503 }, 502, 'ANALYSIS_FAILED'],
    [{ name: 'TimeoutError' }, 504, 'ANALYSIS_TIMEOUT'],
    [{ name: 'AI_NoObjectGeneratedError' }, 502, 'INVALID_AI_OUTPUT'],
    [{ statusCode: 400 }, 502, 'MODEL_REQUEST_REJECTED'],
    [{ name: 'Error' }, 502, 'ANALYSIS_FAILED'],
  ]
  for (const [fields, status, code] of cases) {
    const privateText = 'PRIVATE-RESUME-AND-SECRET-SENTINEL'
    const error = Object.assign(new Error(privateText), fields, { text: privateText, responseBody: privateText })
    const route = loadRoute(async () => { throw error })
    const response = await route.POST(request(input))
    const body = await response.json()
    assert.equal(response.status, status)
    assert.equal(body.code, code)
    assert.ok(body.requestId)
    assert.equal(body.mode, undefined)
    assert.equal(JSON.stringify([body, route.logs]).includes(privateText), false)
    assert.equal(JSON.parse(route.logs[0][0]).requestId, body.requestId)
  }
})

test('rejects invalid AI output instead of returning broken or demo results', async () => {
  for (const output of [undefined, { ...validOutput, requirements: [] },
    { ...validOutput, requirements: [{ ...validOutput.requirements[0], status: 'Great fit' }] },
    { ...validOutput, company: undefined }]) {
    const route = loadRoute(async () => ({ output }))
    const response = await route.POST(request(input))
    assert.equal(response.status, 502)
    assert.equal((await response.json()).code, 'INVALID_AI_OUTPUT')
  }
})


test('missing or blank Google key returns setup instructions without calling AI', async () => {
  for (const key of ['', '   ']) {
    const route = loadRoute(async () => { assert.fail('AI must not be called') }, key)
    const response = await route.POST(request(input))
    const body = await response.json()
    assert.equal(response.status, 503)
    assert.equal(body.code, 'MISSING_GOOGLE_API_KEY')
    assert.ok(body.error.includes('Development'))
    assert.ok(body.error.includes('redeploy'))
    assert.equal(body.mode, undefined)
  }
})


test('real Google SDK sends the Zod schema directly to Gemini and validates its response', async () => {
  let calls = 0
  const route = loadRoute(undefined, 'test-server-key', async (url, init) => {
    calls++
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent')
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'test-server-key')
    assert.equal(String(url).includes('test-server-key'), false)
    const payload = JSON.parse(init.body)
    assert.equal(payload.generationConfig.responseMimeType, 'application/json')
    const schema = payload.generationConfig.responseJsonSchema
    assert.equal(schema.type, 'object')
    if (calls === 1) {
      assert.ok(schema.required.includes('requirements'))
      assert.equal(schema.properties.requirements.minItems, 1)
      assert.equal(schema.properties.requirements.maxItems, 8)
      assert.ok(payload.systemInstruction.parts[0].text.includes('Never invent'))
    } else {
      assert.ok(schema.required.includes('summarySupported'))
      assert.ok(payload.systemInstruction.parts[0].text.includes('Independently compare'))
    }
    const { draft, resume } = calls > 1 ? JSON.parse(payload.contents[0].parts[0].text) : {}
    return Response.json({
      candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(calls === 1 ? validOutput : passingReview(draft, resume)) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 80, totalTokenCount: 180 },
    })
  })
  const response = await route.POST(request(input))
  assert.equal(response.status, 200)
  assert.equal(calls, 2)
  assert.deepEqual(await response.json(), { ...validOutput, mode: 'live' })
  assert.deepEqual(route.logs, [])
})


test('rejects reconstructed or non-contiguous quotes and suggestion originals without exposing text', async () => {
  const original = 'Investigated recurring production incidents with SQL queries and partnered with engineers.'
  const cases = [
    { evidence: 'Investigated incidents with SQL queries' },
    { evidence: 'investigated recurring production incidents' },
    { evidence: 'Investigated recurring  production incidents' },
    { evidence: '?Investigated recurring production incidents?' },
    { original: 'Investigated incidents with SQL queries' },
  ]
  for (const change of cases) {
    const output = { ...validOutput,
      requirements: [{ ...validOutput.requirements[0], evidence: change.evidence ?? 'SQL queries' }],
      suggestions: change.original ? [{ title: 'Clearer wording', reason: 'Keep scope.', original: change.original, suggested: 'Investigated production incidents using SQL.' }] : [],
    }
    const route = loadRoute(async () => ({ output }))
    const response = await route.POST(request({ ...input, resume: original }))
    const body = await response.json()
    assert.equal(response.status, 502)
    assert.equal(body.code, 'INVALID_AI_OUTPUT')
    assert.equal(JSON.stringify([body, route.logs]).includes(original), false)
    assert.equal(body.mode, undefined)
  }
})

test('accepts exact multilingual excerpts, labeled explanations without quotes, and distinct priorities', async () => {
  const resume = 'Built a Python script to compare API error rates.\nChecked dashboards after releases.\n????? ?? ????? ????? ?????? ?????.'
  const output = { ...validOutput, requirements: [
    { ...validOutput.requirements[0], requirement: 'Python automation', priority: 'Responsibility', evidence: 'Built a Python script to compare API error rates.' },
    { ...validOutput.requirements[0], requirement: 'Incident collaboration', priority: 'Required', evidence: '????? ?? ????? ????? ?????? ?????.' },
    { ...validOutput.requirements[0], requirement: 'CI/CD and Terraform', priority: 'Preferred', status: 'Not documented', evidence: null, explanation: 'An advantage in this job; not documented in the resume.' },
  ] }
  const route = loadRoute(async () => ({ output }))
  const response = await route.POST(request({ ...input, resume }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).requirements[2].priority, 'Preferred')
})

test('does not accept clarification answers as quotes from the original resume', async () => {
  const route = loadRoute(async () => ({ output: { ...validOutput,
    requirements: [{ ...validOutput.requirements[0], evidence: 'I administered Kubernetes.' }],
  } }))
  const response = await route.POST(request({ ...input, answers: ['I administered Kubernetes.'] }))
  assert.equal(response.status, 502)
})

// Regression fixture follows the reported scope: investigation, baseline-based
// Python automation, and post-release dashboard checks, with no pipeline/IaC work.
const deploymentResume = [
  'Investigated production issues using logs and SQL queries.',
  'Built a Python script that compares API error rates with historical baselines to help identify unusual behavior and reduce unnecessary alerts.',
  'Follow deployment activity and check dashboards for errors after releases.',
  'Skills: Python, SQL, JavaScript, Grafana, Splunk, Dynatrace, Git, REST APIs.',
].join('\n')
const deploymentJob = 'Production support: troubleshoot using logs and SQL, build Python automation, and check dashboards after releases. CI/CD and Terraform are an advantage.'
const deploymentOutput = {
  ...validOutput,
  requirements: [
    { requirement: 'Log/SQL troubleshooting', priority: 'Responsibility', status: 'Supported', evidence: 'Investigated production issues using logs and SQL queries.', explanation: 'Investigation is documented.' },
    { requirement: 'CI/CD and Terraform', priority: 'Preferred', status: 'Not documented', evidence: null, explanation: 'Not documented; optional advantages.' },
  ],
  summary: 'Production support experience investigating issues with logs and SQL and monitoring dashboards after releases.',
  suggestions: [{ title: 'Describe release checks', reason: 'Clarify the monitoring work.',
    original: 'Follow deployment activity and check dashboards for errors after releases.',
    suggested: 'Monitor dashboards for errors after releases and support CI/CD pipeline deployments.',
  }],
  questions: ['Have you worked directly on CI/CD pipelines or Terraform? If so, what did you do?'],
}

test('deployment-monitoring regression: never invent CI/CD, Terraform, or proficiency, even if the audit approves it', async () => {
  for (const suggested of [deploymentOutput.suggestions[0].suggested,
    'Monitor dashboards and manage Terraform infrastructure.',
    'Proficient in Python, SQL, and production operations.',
    'Expert in post-release operations.']) {
    const output = { ...deploymentOutput, suggestions: [{ ...deploymentOutput.suggestions[0], suggested }] }
    const route = loadRoute(async () => ({ output }))
    const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob }))
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result.suggestions, [])
    assert.equal(result.requirements[1].status, 'Not documented')
    assert.ok(result.questions.length > 0)
  }
})

test('semantic review rejects general responsibility/ownership inflation while retaining grounded rewrites', async () => {
  const grounded = { ...deploymentOutput.suggestions[0], suggested: 'Check dashboards for errors after releases while following deployment activity.' }
  const invented = { ...grounded, suggested: 'Owned release management and led production operations.' }
  const output = { ...deploymentOutput, suggestions: [grounded, invented] }
  const route = loadRoute(async () => ({ output }), 'test-server-key', undefined, async options => {
    const data = JSON.parse(options.prompt)
    assert.equal(data.resume, deploymentResume)
    assert.equal(data.job, deploymentJob)
    assert.equal(data.draft.requirements[1].status, 'Not documented')
    const review = passingReview(output, deploymentResume)
    review.suggestions[1].supported = false
    review.suggestions[1].citations = []
    return { output: review }
  })
  const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob }))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).suggestions, [grounded])
})

test('explicit follow-up confirmation can support pipeline work only with consistent assessments and answer evidence', async () => {
  const answer = 'I support CI/CD pipeline deployments and write Terraform configuration for infrastructure changes.'
  const questions = [deploymentOutput.questions[0]]
  const output = { ...deploymentOutput, requirements: deploymentOutput.requirements.map((row, index) =>
    index === 1 ? { ...row, status: 'Supported', explanation: 'Explicitly confirmed in the applicant answer; not original resume evidence.' } : row) }
  const route = loadRoute(async () => ({ output }), 'test-server-key', undefined, async options => {
    const data = JSON.parse(options.prompt)
    assert.deepEqual(data.clarifications, [{ question: questions[0], answer }])
    const review = passingReview(output, deploymentResume)
    review.suggestions[0].citations.push({ source: 'answer', answerIndex: 0, excerpt: answer })
    return { output: review }
  })
  const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob, answers: [answer], questions }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).suggestions.length, 1)
})

test('negative or hypothetical follow-up is not confirmation of experience', async () => {
  for (const answer of ['No, I have not worked on CI/CD or Terraform.', 'I would like to learn CI/CD and Terraform.']) {
    const route = loadRoute(async () => ({ output: deploymentOutput }), 'test-server-key', undefined, async () => {
      const review = passingReview(deploymentOutput, deploymentResume)
      review.suggestions[0].supported = false
      return { output: review }
    })
    const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob, answers: [answer], questions: [deploymentOutput.questions[0]] }))
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).suggestions, [])
  }
})

test('fails closed on an ungrounded summary, inconsistent assessments, or incomplete review', async () => {
  for (const override of [{ summarySupported: false }, { requirementsConsistent: false }, { suggestions: [] },
    { summaryCitations: [{ source: 'answer', answerIndex: 0, excerpt: 'Not actually confirmed.' }] }]) {
    const route = loadRoute(async () => ({ output: deploymentOutput }), 'test-server-key', undefined,
      async () => ({ output: { ...passingReview(deploymentOutput, deploymentResume), ...override } }))
    const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob }))
    const body = await response.json()
    assert.equal(response.status, 502)
    assert.equal(body.code, 'UNGROUNDED_AI_OUTPUT')
    assert.equal(JSON.stringify([body, route.logs]).includes(deploymentResume), false)
  }
})

test('a contextual yes can confirm a specific responsibility; the question alone cannot', async () => {
  const output = { ...deploymentOutput, requirements: deploymentOutput.requirements.map((row,index) => index===1 ?
    { ...row, requirement: 'CI/CD pipeline deployment support', status: 'Supported', explanation: 'Confirmed explicitly in the answer.' } : row) }
  const question = 'Have you supported CI/CD pipeline deployments?'
  const route = loadRoute(async () => ({ output }), 'test-server-key', undefined, async () => {
    const review = passingReview(output, deploymentResume)
    review.suggestions[0].citations.push({ source: 'answer', answerIndex: 0, excerpt: 'Yes' })
    return { output: review }
  })
  const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob, questions: [question], answers: ['Yes'] }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).suggestions.length, 1)

  const noAnswer = loadRoute(async () => ({ output: deploymentOutput }))
  const withoutConfirmation = await noAnswer.POST(request({ resume: deploymentResume, job: deploymentJob, questions: [question] }))
  assert.equal(withoutConfirmation.status, 200)
  assert.deepEqual((await withoutConfirmation.json()).suggestions, [])
})

test('does not return the draft if the independent reviewer fails', async () => {
  const route = loadRoute(async () => ({ output: deploymentOutput }), 'test-server-key', undefined, async () => {
    throw Object.assign(new Error('PRIVATE-REVIEW-ERROR'), { statusCode: 503 })
  })
  const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob }))
  const body = await response.json()
  assert.equal(response.status, 502)
  assert.equal(body.mode, undefined)
  assert.equal(body.suggestions, undefined)
  assert.equal(JSON.stringify([body, route.logs]).includes('PRIVATE-REVIEW-ERROR'), false)
})

test('confirmed experience cannot appear in a rewrite while its assessment still says Not documented', async () => {
  const route = loadRoute(async () => ({ output: deploymentOutput }))
  const response = await route.POST(request({ resume: deploymentResume, job: deploymentJob,
    answers: ['I support CI/CD pipeline deployments.'] }))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).suggestions, [])
})
