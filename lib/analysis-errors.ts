// Never return or log SDK error messages, prompts, responses, or Zod issues:
// they can contain applicant text and authorization details.
export function analysisFailure(error: unknown) {
  type Failure = {
    name?: string; statusCode?: number; cause?: unknown; lastError?: unknown;
    data?: { error?: { details?: { reason?: string }[] } };
  }
  const chain: Failure[] = []
  let current = error
  while (current && typeof current === 'object' && chain.length < 8) {
    const item = current as Failure
    chain.push(item)
    current = item.lastError ?? item.cause
  }
  const has = (...names: string[]) => chain.some(item => names.includes(item.name ?? ''))
  const status = (...values: number[]) => chain.some(item => values.includes(item.statusCode ?? 0))
  // Google returns invalid API keys as HTTP 400, not necessarily 401.
  const invalidKey = chain.some(item => Array.isArray(item.data?.error?.details) &&
    item.data.error.details.some(detail => detail?.reason === 'API_KEY_INVALID' || detail?.reason === 'API_KEY_EXPIRED'))

  if (has('GroundingError'))
    return { code: 'UNGROUNDED_AI_OUTPUT', status: 502, message: 'The analysis did not pass its factual consistency check. Please retry. Unsupported resume claims have not been returned.' }

  if (has('AI_LoadAPIKeyError'))
    return { code: 'MISSING_GOOGLE_API_KEY', status: 503, message: 'Live analysis needs GOOGLE_GENERATIVE_AI_API_KEY. Add it in v0 Project Menu (...) > Environment Variables for Development and restart the preview. For deployment, add it in Vercel Project Settings > Environment Variables for Production/Preview and redeploy. Never paste the key into the app or chat.' }
  if (invalidKey || status(401))
    return { code: 'GEMINI_AUTH', status: 503, message: 'Gemini rejected the API key. Replace GOOGLE_GENERATIVE_AI_API_KEY with a valid Google AI Studio key in the project environment settings, then restart the preview or redeploy.' }
  if (status(403))
    return { code: 'GEMINI_ACCESS', status: 503, message: 'Google denied access to Gemini. Check the API key restrictions, Gemini API access, and project/region eligibility in Google AI Studio or Google Cloud Console.' }
  if (has('AI_NoSuchModelError') || status(404))
    return { code: 'MODEL_UNAVAILABLE', status: 503, message: 'Google could not find gemini-3.1-flash-lite for this project. Check model availability and Gemini API access in Google AI Studio.' }
  if (status(429))
    return { code: 'GEMINI_QUOTA_EXCEEDED', status: 429, message: 'Gemini quota is exhausted or the request rate limit was reached. Wait for the limit to reset and retry. Check this project\'s free-tier quota and usage in Google AI Studio; retrying immediately may not help.' }
  if (has('AbortError', 'TimeoutError') || status(408, 504))
    return { code: 'ANALYSIS_TIMEOUT', status: 504, message: 'Live analysis timed out. Please retry with shorter inputs.' }
  if (has('AI_NoObjectGeneratedError', 'AI_NoOutputGeneratedError', 'AI_TypeValidationError', 'AI_JSONParseError', 'ZodError'))
    return { code: 'INVALID_AI_OUTPUT', status: 502, message: 'Gemini returned an incomplete or invalid analysis. Please retry. No demo results have been substituted.' }
  if (has('AI_UnsupportedFunctionalityError') || status(400, 422))
    return { code: 'MODEL_REQUEST_REJECTED', status: 502, message: 'Gemini rejected the analysis request. Check Gemini API configuration and model structured-output support using the request reference.' }
  return { code: 'ANALYSIS_FAILED', status: 502, message: 'Gemini is temporarily unavailable or could not be reached. Please retry. If this persists, check the server logs using the request reference.' }
}
