import type { ExtractionSchema } from './ports.js';

/**
 * Disqualifying property conditions, as a closed vocabulary.
 *
 * This list is the answer to "why not just a keyword list?" A model reads the
 * applicant's own words — however they phrased them — and maps them onto exactly these
 * codes. It never decides anything; it classifies into a fixed set. A rule then does
 * set membership against a YAML list, which is ordinary arithmetic on an enum.
 */
export const CONDITION_CODES = [
  'ROOF_DAMAGE',
  'WATER_INTRUSION',
  'FLOOD_DAMAGE',
  'FIRE_DAMAGE',
  'FOUNDATION_ISSUE',
  'MOLD',
  'UNPERMITTED_WORK',
  'UNINHABITABLE',
  'DEFERRED_MAINTENANCE_MAJOR',
  'PEST_INFESTATION',
  'SEPTIC_OR_WELL_FAILURE',
  'HVAC_FAILURE',
  'COSMETIC_ONLY',
  'NONE_DISCLOSED',
] as const;

/**
 * Free text from the application's "why do you want the money" box.
 *
 * The whole packet contains nothing more legally loaded than this field: it is the
 * applicant, in their own words, frequently telling you the exact reason they will later
 * be declined. Hometap rejected an applicant for damage he had disclosed here at intake;
 * Estevan G. replaced a roof and was declined at 4.5 months.
 */
export const APPLICATION_FREE_TEXT_SCHEMA: ExtractionSchema = {
  schemaId: 'application_free_text.v1',
  promptId: 'extract.application_free_text.v1',
  kind: 'APPLICATION_FREE_TEXT',
  fields: [
    {
      factKey: 'application.disclosed_conditions',
      description:
        'Property condition problems the applicant describes, in any phrasing, including ' +
        'implied ones ("the ceiling stains after it rains" is WATER_INTRUSION). Return ' +
        'NONE_DISCLOSED if the text describes no condition problem. Do not infer problems ' +
        'from the mere fact that money is wanted.',
      type: 'enum_array',
      enumValues: CONDITION_CODES,
    },
    {
      factKey: 'application.disclosed_co_owners',
      description:
        'Names of any other person the applicant mentions as being on the deed or title, ' +
        'including relatives abroad. Empty if none mentioned.',
      type: 'enum_array',
      enumValues: [],
    },
    {
      factKey: 'application.stated_purpose_category',
      description: 'The primary use of funds the applicant describes.',
      type: 'enum',
      enumValues: [
        'HOME_REPAIR', 'DEBT_CONSOLIDATION', 'EDUCATION', 'MEDICAL', 'BUSINESS',
        'RETIREMENT_INCOME', 'INVESTMENT', 'OTHER', 'UNSTATED',
      ],
    },
  ],
};

export const PRELIM_TITLE_SCHEMA: ExtractionSchema = {
  schemaId: 'prelim_title.v1',
  promptId: 'extract.prelim_title.v1',
  kind: 'PRELIM_TITLE',
  fields: [
    { factKey: 'title.apn', description: 'Assessor parcel number from Schedule A.', type: 'string' },
    {
      factKey: 'title.vesting_names',
      description: 'Exact vested owner names from Schedule A, verbatim.',
      type: 'enum_array',
      enumValues: [],
    },
    {
      factKey: 'title.vesting_type',
      description: 'How title is held.',
      type: 'enum',
      enumValues: ['INDIVIDUAL', 'JOINT_TENANCY', 'TENANCY_IN_COMMON', 'COMMUNITY_PROPERTY', 'TRUST', 'LLC'],
    },
    {
      factKey: 'title.estate_type',
      description: 'Fee simple or leasehold, from Schedule A.',
      type: 'enum',
      enumValues: ['FEE_SIMPLE', 'LEASEHOLD'],
    },
    {
      factKey: 'title.lien_schedule',
      description:
        'EVERY monetary lien in Schedule B with its amount and position. Include ones the ' +
        'applicant did not declare — that omission is the point of reading this document.',
      type: 'object_array',
      itemShape: { holder: 'string', amount: 'number', position: 'number', type: 'string' },
    },
    {
      factKey: 'title.lien_types',
      description: 'Categories of every Schedule B encumbrance.',
      type: 'enum_array',
      enumValues: [
        'DOT', 'MORTGAGE', 'HELOC', 'HOME_EQUITY_LOAN', 'PACE', 'HERO', 'MECHANICS',
        'TAX_LIEN', 'JUDGMENT', 'LIS_PENDENS', 'REVERSE_MORTGAGE',
        'SHARED_EQUITY_AGREEMENT', 'MELLO_ROOS_DELINQUENT', 'EASEMENT', 'CCR',
      ],
    },
    {
      factKey: 'title.exception_types',
      description: 'Non-monetary Schedule B exceptions that restrict transfer.',
      type: 'enum_array',
      enumValues: ['RIGHT_OF_FIRST_REFUSAL', 'RESALE_RESTRICTION', 'DEED_RESTRICTION', 'NO_LEGAL_ACCESS'],
    },
  ],
};

export const URAR_SCHEMA: ExtractionSchema = {
  schemaId: 'urar_1004.v1',
  promptId: 'extract.urar_1004.v1',
  kind: 'URAR_1004',
  fields: [
    { factKey: 'valuation.appraised_value', description: 'Final reconciled opinion of value.', type: 'number' },
    { factKey: 'valuation.effective_date', description: 'Effective date of the appraisal.', type: 'date' },
    { factKey: 'valuation.apn', description: 'Assessor parcel number of the subject property.', type: 'string' },
    {
      factKey: 'valuation.condition_rating',
      description: 'UAD condition rating of the improvements.',
      type: 'enum',
      enumValues: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
    },
    {
      factKey: 'valuation.quality_rating',
      description: 'UAD quality rating.',
      type: 'enum',
      enumValues: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'],
    },
    { factKey: 'property.lot_acres', description: 'Site area in acres.', type: 'number' },
    {
      factKey: 'property.type',
      description: 'Property type as described in the Subject and Improvements sections.',
      type: 'enum',
      enumValues: [
        'SINGLE_FAMILY', 'CONDO', 'TOWNHOME', 'MULTIFAMILY_2_4', 'MULTIFAMILY_5_PLUS',
        'MANUFACTURED', 'MODULAR', 'MOBILE', 'LOG_CABIN', 'HOUSEBOAT', 'VACANT_LAND',
      ],
    },
  ],
};

export const INSURANCE_DEC_SCHEMA: ExtractionSchema = {
  schemaId: 'insurance_dec.v1',
  promptId: 'extract.insurance_dec.v1',
  kind: 'INSURANCE_DEC',
  fields: [
    { factKey: 'insurance.coverage_a_usd', description: 'Coverage A, dwelling.', type: 'number' },
    { factKey: 'insurance.expiration_date', description: 'Policy expiration date.', type: 'date' },
    {
      factKey: 'insurance.valuation_basis',
      description: 'Whether the dwelling is insured at replacement cost or actual cash value.',
      type: 'enum',
      enumValues: ['REPLACEMENT_COST', 'EXTENDED_REPLACEMENT_COST', 'ACTUAL_CASH_VALUE'],
    },
    {
      factKey: 'insurance.policy_form',
      description: 'Policy form. DP-3 and similar indicate a rental, not an owner-occupied home.',
      type: 'enum',
      enumValues: ['HO3', 'HO5', 'HO6', 'DP1', 'DP3', 'OTHER'],
    },
  ],
};

export const ALL_SCHEMAS: readonly ExtractionSchema[] = [
  APPLICATION_FREE_TEXT_SCHEMA,
  PRELIM_TITLE_SCHEMA,
  URAR_SCHEMA,
  INSURANCE_DEC_SCHEMA,
];

/**
 * Proof, as an executable check rather than a claim: no schema anywhere offers a model
 * a place to put a decision. Asserted in schemas.test.ts.
 */
export const DECISION_SHAPED_KEYS = [
  'decision', 'verdict', 'approve', 'approved', 'decline', 'declined', 'eligible',
  'eligibility', 'outcome', 'recommendation', 'disposition', 'status',
];
