const CECR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const MAIN_OBJECTIVES = ['PARLER', 'ECRIRE', 'LIRE', 'ECOUTER', 'MIXTE']
const LESSON_TYPES = [
  'VOCABULAIRE_THEMATIQUE',
  'GRAMMAIRE_STRUCTUREE',
  'DIALOGUE_INTERACTIF',
  'EXERCICES_PRATIQUES',
  'LECTURE_ANALYTIQUE',
  'PHONETIQUE_PRONONCIATION',
  'CULTURE_ET_CIVILISATION',
]
const VALID_DURATIONS = [15, 30, 45, 60, 90]

const DEFAULT_PARAMS = {
  niveau: 'A1',
  objectif_principal: 'MIXTE',
  type_de_lecon: ['VOCABULAIRE_THEMATIQUE', 'EXERCICES_PRATIQUES'],
  theme: 'La vie quotidienne',
  langue_maternelle_apprenant: 'francais',
  contexte_culturel: 'Madagascar',
  duree_estimee_minutes: 45,
  mode_adaptatif: true,
  inclure_phonetique: true,
  inclure_culture_allemande: true,
}

const BASE_SYSTEM_PROMPT = [
  'Tu es DeutschMeister-AI, expert DaF/CECR (A1 a C2).',
  'Tu generes une lecon d allemand avec exercices adaptes au niveau.',
  'Tu retournes uniquement du JSON valide.',
  'Tu respectes strictement les parametres fournis.',
  'Tu n utilises pas de contenu hors niveau CECR.',
  'Tu appliques la progression pedagogique Presentation -> Pratique -> Production.',
].join('\n')

const OUTPUT_SCHEMA = {
  metadata: {
    generated_at: 'ISO8601_TIMESTAMP',
    generator_version: 'DeutschMeister-AI v3.0',
    estimated_duration_minutes: 45,
    difficulty_score: 0,
    tags: [],
  },
  level: {
    cecr: 'A1|A2|B1|B2|C1|C2',
    label_fr: 'Debutant absolu|Elementaire|Intermediaire|Intermediaire superieur|Avance|Maitrise',
    label_de: 'Anfaenger|Grundstufe|Mittelstufe|Obere Mittelstufe|Fortgeschritten|Meisterniveau',
    prerequisite_levels: [],
  },
  objective: {
    skill: 'PARLER|ECRIRE|LIRE|ECOUTER|MIXTE',
    can_do_statement_fr: '',
    can_do_statement_de: '',
    micro_objectives: [],
  },
  title: { fr: '', de: '' },
  vocabulary: {
    theme: '',
    total_words: 0,
    words: [],
    thematic_groups: [],
    mind_map_text: '',
  },
  grammar: {
    main_rule: '',
    secondary_rules: [],
    explanation: { fr: '', de: '' },
    formula: '',
    tables: [],
    examples_positive: [],
    examples_negative: [],
    contrastive_note_fr: '',
    common_errors_by_level: [],
    exceptions: [],
    advanced_notes: '',
  },
  phonetics: {
    focus_sounds: [],
    rules: [],
    rhythm_and_stress: '',
    intonation_patterns: [],
  },
  dialogues: [],
  exercises: [],
  cultural_content: {
    germany_fact: {
      title: '',
      content: '',
      vocabulary_linked: [],
      comparison_malagasy: '',
    },
    intercultural_tip: '',
    idiom_of_the_day: {
      german: '',
      literal: '',
      meaning: '',
      usage_example: '',
      register: '',
    },
  },
  tips: {
    memory_techniques: [],
    grammar_shortcuts: [],
    learning_habits: [],
    next_lesson_preview: '',
    encouragement: { fr: '', de: '' },
  },
  self_assessment: {
    checklist: [],
    reflection_questions_fr: [],
  },
  adaptive_learning: {
    profiling_questions: [],
    performance_tracking: {
      metrics: ['accuracy_rate', 'response_time', 'hint_usage', 'retry_count'],
      thresholds: {
        mastery: '>= 80% sur 2 tentatives consecutives',
        review_needed: '< 60% sur 1 tentative',
        struggling: '< 40% + plus de 3 aides',
      },
    },
  },
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function sanitizeLessonTypes(value) {
  const input = Array.isArray(value) ? value : DEFAULT_PARAMS.type_de_lecon
  const cleaned = input.filter((t) => LESSON_TYPES.includes(t))
  if (!cleaned.length) return DEFAULT_PARAMS.type_de_lecon
  return [...new Set(cleaned)].slice(0, 3)
}

function normalizeParams(raw = {}) {
  const niveau = pickEnum(String(raw.niveau || '').toUpperCase(), CECR_LEVELS, DEFAULT_PARAMS.niveau)
  const objectif_principal = pickEnum(
    String(raw.objectif_principal || '').toUpperCase(),
    MAIN_OBJECTIVES,
    DEFAULT_PARAMS.objectif_principal,
  )
  const duree = Number(raw.duree_estimee_minutes)
  const duree_estimee_minutes = VALID_DURATIONS.includes(duree)
    ? duree
    : DEFAULT_PARAMS.duree_estimee_minutes

  return {
    niveau,
    objectif_principal,
    type_de_lecon: sanitizeLessonTypes(raw.type_de_lecon),
    theme: String(raw.theme || DEFAULT_PARAMS.theme).trim() || DEFAULT_PARAMS.theme,
    langue_maternelle_apprenant:
      String(raw.langue_maternelle_apprenant || DEFAULT_PARAMS.langue_maternelle_apprenant).trim() ||
      DEFAULT_PARAMS.langue_maternelle_apprenant,
    contexte_culturel:
      String(raw.contexte_culturel || DEFAULT_PARAMS.contexte_culturel).trim() || DEFAULT_PARAMS.contexte_culturel,
    duree_estimee_minutes,
    mode_adaptatif: raw.mode_adaptatif ?? DEFAULT_PARAMS.mode_adaptatif,
    inclure_phonetique: raw.inclure_phonetique ?? DEFAULT_PARAMS.inclure_phonetique,
    inclure_culture_allemande: raw.inclure_culture_allemande ?? DEFAULT_PARAMS.inclure_culture_allemande,
  }
}

function buildLessonExercisePrompt(rawParams = {}) {
  const params = normalizeParams(rawParams)
  const userInstructions = [
    'Genere une lecon complete en JSON.',
    'Respecte les contraintes suivantes:',
    '- Coherence thematique totale',
    '- Niveau CECR strict',
    '- Exercices avec reponses et explications',
    '- Variantes adaptatives si mode_adaptatif = true',
    '- Inclure IPA dans le vocabulaire',
    '- Inclure ancrage malgache si contexte_culturel = Madagascar',
    '',
    'PARAMETRES:',
    JSON.stringify(params, null, 2),
    '',
    'FORMAT DE SORTIE OBLIGATOIRE (meme cles, champs vides autorises via null ou []):',
    JSON.stringify(OUTPUT_SCHEMA, null, 2),
  ].join('\n')

  return {
    params,
    messages: [
      { role: 'system', content: BASE_SYSTEM_PROMPT },
      { role: 'user', content: userInstructions },
    ],
  }
}

module.exports = {
  CECR_LEVELS,
  MAIN_OBJECTIVES,
  LESSON_TYPES,
  VALID_DURATIONS,
  DEFAULT_PARAMS,
  OUTPUT_SCHEMA,
  normalizeParams,
  buildLessonExercisePrompt,
}
