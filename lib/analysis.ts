import { z } from 'zod'

export const MAX_LENGTH = 16000

// Required nullable fields work with strict structured-output providers.
export const analysisSchema = z.object({
  role: z.string().min(1),
  company: z.string().nullable(),
  assessment: z.string().min(1).describe('Specific documented matches and uncertainties, never a blanket hiring verdict or claim of meeting all requirements.'),
  requirements: z.array(z.object({
    requirement: z.string().min(1),
    priority: z.enum(['Required', 'Preferred', 'Responsibility']).describe('Use the job description wording: advantages/nice-to-haves are Preferred, never Required. Include main responsibilities too.'),
    status: z.enum(['Supported', 'Partially supported', 'Not documented']),
    evidence: z.string().min(1).nullable().describe('One exact contiguous substring copied from the original resume, without added quotation marks, ellipses, word removal, or normalization. Use null when no exact excerpt is available.'),
    explanation: z.string().min(1),
  })).min(1).max(8),
  suggestions: z.array(z.object({
    title: z.string().min(1),
    reason: z.string().min(1),
    original: z.string().min(1).describe('An exact contiguous substring copied from the original resume.'),
    suggested: z.string().min(1),
  })).max(4),
  questions: z.array(z.string().min(1)).max(4),
  summary: z.string().min(1).describe('Paste-ready resume summary in the resume language. Supported professional facts only. No applicant name, recruiter assessment, advice, gaps, or suitability claims.'),
})

export const liveAnalysisSchema = analysisSchema.extend({ mode: z.literal('live') })

// Validate against the actual input, with no whitespace/case normalization or
// reconstructed quotations. Never include rejected text in logs or errors.
export function analysisSchemaForResume(resume: string) {
  return analysisSchema.superRefine((analysis, context) => {
    analysis.requirements.forEach((item, index) => {
      if (item.evidence !== null && !resume.includes(item.evidence)) {
        context.addIssue({ code: 'custom', path: ['requirements', index, 'evidence'], message: 'Evidence must be an exact resume excerpt.' })
      }
    })
    analysis.suggestions.forEach((item, index) => {
      if (!resume.includes(item.original)) {
        context.addIssue({ code: 'custom', path: ['suggestions', index, 'original'], message: 'Original text must be an exact resume excerpt.' })
      }
    })
  })
}
