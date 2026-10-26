# ResumeFit

ResumeFit compares a resume with a job description and produces grounded wording suggestions. Live analysis calls the **Google Gemini Developer API directly** through the Vercel AI SDK's `@ai-sdk/google` provider. It uses **`gemini-3.1-flash-lite`**. AI Gateway authentication, Vercel OIDC, and provider/model gateway IDs are not used by this flow.

The design is unchanged. **Try an example** remains a separate, clearly labeled demo feature. Failed live requests never substitute demo data.

## Model verification

Verified against Google's documentation on October 26, 2026: [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) is a stable Gemini API model supporting structured output. Google's [pricing table](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite) lists its standard input/output tokens as free of charge on the Free Tier. Available quota depends on the Google project and eligibility; a billing-enabled project's paid usage is not made free by this code. Check actual project limits in Google AI Studio.

The existing Zod schema uses objects, bounded arrays, strings, enums, and nullable fields. It is passed through `Output.object` and validated again on the server and client. The existing grounded analysis rules are retained. The model is explicit in `app/api/analyze/route.ts`; there is no automatic provider, model, or demo fallback.

## Secure API key setup

Create a Gemini Developer API key in [Google AI Studio](https://aistudio.google.com/apikey). Set **`GOOGLE_GENERATIVE_AI_API_KEY`** only in server environment settings. Never paste it into chat, resume fields, source code, logs, or a `NEXT_PUBLIC_` variable.

### v0 preview

1. Open the ResumeFit project in v0.
2. Open **Project Menu (...) > Environment Variables**.
3. Add `GOOGLE_GENERATIVE_AI_API_KEY` and enter the key in the secure value field.
4. Select **Development**. The v0 preview panel uses Development variables, not the Preview deployment environment.
5. Save and restart the v0 preview/runtime so the server loads the new variable. A browser refresh alone may retain the old server environment.

See [v0 external API settings](https://v0.app/docs/external-apis).

### Deployment on Vercel

1. Open the **same linked project** in the Vercel dashboard.
2. Open **Settings > Environment Variables** and add `GOOGLE_GENERATIVE_AI_API_KEY` as a sensitive server variable.
3. Enable **Production** for the published site and **Preview** if you use branch/preview deployments. Enable Development too if managing the v0 variable here.
4. Save, then **redeploy** the relevant deployment. Existing deployments do not receive environment changes until redeployed.

The v0 preview and a Vercel Preview deployment are different environments. Configure each scope you actually use. Adding a key in hosted settings does not add it to this local checkout.

### Local development

```bash
pnpm install
```

Copy `.env.example` to `.env.local` in the project root (`C:\dev\Role-fit\.env.local` in this checkout). Set `GOOGLE_GENERATIVE_AI_API_KEY`, then start or restart the dev server:

```bash
pnpm dev
```

No AI Gateway key, OIDC token, or `ANALYSIS_MODEL` setting is required. The Google key is read only in the server route. Resume and job text is sent to Google for the requested analysis and is not persisted or logged by this app. Google's free-tier pricing states that content can be used to improve its products; review Google's terms before submitting personal data.

## Errors and safe diagnostics

The UI preserves inputs and shows an actionable error plus a reference ID. Look up that ID in the local server terminal or hosting function logs. Failure logs contain only the event name, request ID, category, status, and duration. Never log raw SDK errors: messages, response bodies, prompts, stacks, and Zod issues can contain sensitive text.

| Error category | Action |
| --- | --- |
| `MISSING_GOOGLE_API_KEY` | Add the server variable in the correct environment; restart the preview or redeploy. |
| `GEMINI_AUTH` | Replace an invalid/expired key from Google AI Studio; restart or redeploy. |
| `GEMINI_ACCESS` | Check API key restrictions, API enablement, project permissions, and region eligibility. |
| `GEMINI_QUOTA_EXCEEDED` | Free quota may be exhausted or requests rate limited. Check usage/limits in Google AI Studio and wait for reset. Immediate retries may keep failing. |
| `MODEL_UNAVAILABLE` | Check access to `gemini-3.1-flash-lite` for the Google project. |
| `MODEL_REQUEST_REJECTED` | Check Gemini API request and structured-output compatibility. |
| `INVALID_AI_OUTPUT` | Gemini returned incomplete/schema-invalid output; retry. |
| `ANALYSIS_TIMEOUT` | Retry with shorter inputs. |
| `ANALYSIS_FAILED` | Google/network failure; retry and check safe logs by reference. |

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

Tests cover input validation, custom inputs/clarifications, the exact Google model/provider, direct Gemini request serialization with the real SDK and a mocked HTTP response, missing/invalid credentials, quota/access/provider failures, output validation, and sensitive-data exclusion. Tests do not prove actual project quota or authenticated model access.

After configuring GOOGLE_GENERATIVE_AI_API_KEY in the local .env file and starting the server, a real POST /api/analyze with synthetic custom inputs returned HTTP 200 and mode: live. The response passed server-side validation and contained four requirements, two suggestions, and two clarification questions; Kubernetes experience absent from the synthetic resume was marked Not documented. An earlier request returned Google 503 UNAVAILABLE; a subsequent request succeeded. The key and input/output text were not logged. Hosted v0/deployment configuration and browser interaction remain unverified; no hosted deployment identity is present in this checkout.

## Content grounding

The breakdown covers both responsibilities and qualifications, with explicit Required, Preferred, or Responsibility labels taken from the job description. Advantages such as CI/CD and Terraform remain preferred when the job says so. The summary is instructed to be paste-ready professional resume text with supported facts only; the assessment describes specific matches and uncertainties. Follow-up questions focus on unresolved job requirements and core responsibilities.

Every evidence excerpt and suggestion original is checked as an exact contiguous substring of the submitted resume on both server and client. Reconstructed quotes, omitted middle words, case changes, and altered whitespace fail validation rather than being displayed. Where no exact excerpt is suitable, the model must return null evidence and give a separately labeled paraphrase/interpretation. Applicant clarifications cannot be quoted as original resume text.

Before the additional semantic-review change, a live synthetic regression returned HTTP 200 with all five target responsibilities covered, CI/CD/Terraform classified as Preferred, and all excerpts/originals matching the input. Nine regression tests, TypeScript, and the production build passed. Semantic content remains model-generated; browser visual verification was not performed.

## Rewrite consistency review

After generation and exact-excerpt validation, a separate Gemini call reviews every rewrite and the professional summary against the original resume, explicit applicant answers, and requirement assessments. The reviewer must cite exact source excerpts and reject added skills, responsibilities, ownership, impact, or proficiency. The server checks citation provenance and review completeness. Unsupported suggestions are removed; an unsupported summary, inconsistent assessments, or failed review prevents a successful response. The draft is never returned if review fails. Both model calls share the original 60-second deadline.

Conservative additional checks block new CI/CD, Terraform, and proficiency language absent from the supplied facts. Post-release dashboard checks do not establish pipeline deployment support. Follow-up answers include question context; questions alone, negative answers, and hypothetical interest are not confirmation. The semantic check is model-based and reduces factual errors; exact citation validation alone does not establish entailment. The copy buttons now specify a dark foreground so labels remain visible within the dark summary card.

Current verification: 17 regression tests, TypeScript, and production build passed. The deployment-monitoring fixture rejects invented CI/CD/Terraform/proficiency claims, retains a grounded rewrite while rejecting inflated ownership, and tests explicit confirmation, contextual yes, negative answers, and review failure. New live verification attempts could not complete because Google returned HTTP 503 UNAVAILABLE during generation; the added semantic review has not yet completed a successful live end-to-end run. Browser visual verification was not performed.
