/**
 * The seam. Everything the model touches goes through these interfaces, and every
 * implementation is injected — never constructed here.
 *
 * The critical property is in `ExtractionSchema`: it describes FACTS ONLY. There is no
 * field anywhere in this file that a model could write a decision into. That is not a
 * prompt instruction the model might ignore; it is the shape of the return type.
 */

export interface LlmRequest {
  readonly promptId: string;
  readonly promptText: string;
  readonly documentText: string;
  /** JSON Schema the response must satisfy. Facts only — see above. */
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly maxTokens: number;
}

export interface LlmResponse {
  readonly modelId: string;
  /** Kept verbatim. If you only keep the parsed output you cannot debug a bad read. */
  readonly rawText: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly finishReason: string;
}

/** The only door to a model in the entire system. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface Clock {
  now(): string;
}

export type DocumentKind =
  | 'PRELIM_TITLE'
  | 'URAR_1004'
  | 'INSURANCE_DEC'
  | 'PROPERTY_TAX'
  | 'MORTGAGE_STATEMENT'
  | 'GOVERNMENT_ID'
  | 'APPLICATION_FREE_TEXT'
  | 'UNKNOWN';

export interface SourceDocument {
  readonly documentId: string;
  readonly kind: DocumentKind;
  /** Already OCR'd where needed. Untrusted content — see extractor.ts. */
  readonly text: string;
}

/**
 * One field the extractor is asked to find. `enumValues` is doing more work than it
 * looks: constraining a model to a closed vocabulary is what lets a downstream rule use
 * exact set membership instead of string matching on free prose.
 */
export interface FieldSpec {
  readonly factKey: string;
  readonly description: string;
  readonly type: 'string' | 'number' | 'date' | 'enum' | 'enum_array' | 'object_array';
  readonly enumValues?: readonly string[];
  readonly itemShape?: Readonly<Record<string, 'string' | 'number'>>;
}

export interface ExtractionSchema {
  readonly schemaId: string;
  readonly promptId: string;
  readonly kind: DocumentKind;
  readonly fields: readonly FieldSpec[];
}
