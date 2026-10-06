import { MarkerType } from '@vue-flow/core'

const overview = [
  {
    id: 'sign-in', type: 'system', position: { x: 0, y: 120 },
    data: { title: 'Sign in & start', label: 'The app checks who you are and opens a visit.', system: 'STEP 1', status: 'partial', parts: ['Learner', 'Nuxt browser', 'Supabase sign-in', 'Express API'], detail: 'A learner opens GPTMD, signs in through Supabase, and asks the API to start a visit. The API checks the signed token, user, organization membership, and visit permission.', returnTarget: true },
  },
  {
    id: 'prepare', type: 'system', position: { x: 340, y: 120 },
    data: { title: 'Prepare patient', label: 'A fixed case is created, checked, and made ready.', system: 'STEP 2', status: 'working', parts: ['Express API', 'OpenAI Responses', 'PostgreSQL fixed case', 'Redis live visit'], detail: 'The API asks OpenAI for a structured fictional patient case, validates it, stores the fixed case in PostgreSQL, and creates the live visit state in Redis.' },
  },
  {
    id: 'talk', type: 'system', position: { x: 680, y: 120 },
    data: { title: 'Talk to patient', label: 'You ask; the simulated patient answers.', system: 'STEP 3', status: 'working', parts: ['Nuxt encounter screen', 'Express API', 'OpenAI Responses', 'Redis live session'], detail: 'The API assembles only the allowed case context, asks OpenAI to respond as the patient, checks the response, then saves the accepted exchange and newly disclosed facts.', returnSource: true },
  },
  {
    id: 'save', type: 'system', position: { x: 1020, y: 120 },
    data: { title: 'Save & review', label: 'The visit is saved; answers can be submitted but are not scored yet.', system: 'STEP 4', status: 'partial', parts: ['RedisJSON live visit', 'Redis Stream event queue', 'Persistence worker', 'PostgreSQL history', 'Unscored assessment'], detail: 'Accepted turns are saved to the live visit and copied into PostgreSQL. Assessment submission works, but scoring and educator review are not implemented yet.' },
  },
]

const edges = [
  { id: 'sign-prepare', source: 'sign-in', target: 'prepare', type: 'smoothstep', markerEnd: MarkerType.ArrowClosed, animated: false },
  { id: 'prepare-talk', source: 'prepare', target: 'talk', type: 'smoothstep', markerEnd: MarkerType.ArrowClosed, animated: false },
  { id: 'talk-save', source: 'talk', target: 'save', type: 'smoothstep', markerEnd: MarkerType.ArrowClosed, animated: false },
  { id: 'reply-sign', source: 'talk', sourceHandle: 'return-source', target: 'sign-in', targetHandle: 'return-target', label: 'patient reply', type: 'smoothstep', markerEnd: MarkerType.ArrowClosed, animated: false, data: { loop: true } },
]

const detailGraphs = {
  'sign-in': {
    title: 'Signing in and opening a visit',
    intro: 'The browser asks to sign in. Before a visit is returned, the API checks identity and access.',
    nodes: [
      ['browser', 'Browser', 'Starts Google sign in through Supabase.', 'working'],
      ['supabase', 'Supabase', 'Signs the user in and provides a signed access token.', 'partial'],
      ['api', 'Express API', 'Checks the token and resolves the user and membership.', 'working'],
      ['membership', 'Access rules', 'Checks organization, session owner, and learner role.', 'working'],
      ['visit', 'Visit session', 'Creates an opaque session tied to this learner and organization.', 'working'],
    ],
    links: [['browser','supabase','sign-in request'],['supabase','api','signed token'],['api','membership','who may access'],['membership','visit','allowed visit']],
    states: ['Google callback needs live credential verification. Organization/customer profiles are not modeled yet.'],
  },
  prepare: {
    title: 'Preparing the simulated patient',
    intro: 'One fixed case is created and checked before the learner enters the room.',
    nodes: [
      ['browser', 'Browser', 'Shows readiness and the learner safe patient details.', 'working'],
      ['api', 'Express API', 'Checks permission and queues bounded setup work.', 'working'],
      ['openai', 'OpenAI Responses', 'Returns a structured fictional patient case.', 'working'],
      ['validate', 'Case checks', 'Checks schema and consistency rules before accepting the case.', 'working'],
      ['postgres', 'PostgreSQL', 'Stores the immutable case and session record.', 'working'],
      ['redis', 'Redis', 'Holds the active patient profile, visit state, and provider conversation link.', 'working'],
    ],
    links: [['browser','api','start visit'],['api','openai','create case'],['openai','validate','structured case'],['validate','postgres','fixed case'],['validate','redis','active visit state'],['redis','browser','ready to enter']],
    states: ['Educator reviewed cases and approved rubrics are not connected yet.'],
  },
  talk: {
    title: 'One patient conversation turn',
    intro: 'This is the loop that repeats each time the learner asks something.',
    nodes: [
      ['learner', 'Learner', 'Asks the patient a question.', 'working'],
      ['browser', 'Encounter screen', 'Sends the question and turn ID to the API.', 'working'],
      ['api', 'Express API', 'Serializes turns, checks retry keys, and selects allowed case context.', 'working'],
      ['openai', 'OpenAI Responses', 'Creates a patient reply using the server-held conversation.', 'working'],
      ['redis', 'Redis live visit', 'Atomically saves the accepted reply, retry key, and newly shared facts.', 'working'],
      ['browserReply', 'Patient reply', 'Returns the accepted reply to the learner.', 'working'],
    ],
    links: [['learner','browser','asks'],['browser','api','question'],['api','openai','authorized context'],['openai','api','patient reply'],['api','redis','accepted turn'],['redis','browserReply','saved reply'],['browserReply','learner','shows response']],
    states: ['Full audio encounter and server measured audio duration are not complete. Transcript turns are the supported mode.'],
  },
  save: {
    title: 'How a visit is saved',
    intro: 'The learner gets a reply after the live visit state is safe. A separate worker saves the lasting event history.',
    nodes: [
      ['api', 'Express API', 'Finishes an accepted turn.', 'working'],
      ['live', 'RedisJSON', 'Stores the current profile, transcript, reply, and retry key.', 'working'],
      ['stream', 'Redis Stream', 'Queues the accepted turn and disclosure events.', 'working'],
      ['worker', 'Save worker', 'Copies events in order and retries safely after errors.', 'working'],
      ['postgres', 'PostgreSQL', 'Stores lasting session and event records for recovery.', 'working'],
      ['assessment', 'Assessment', 'Accepts and stores the learner submission without scoring it.', 'partial'],
      ['planned', 'Scoring & feedback', 'Rubric scoring and educator reviewed feedback are planned.', 'planned'],
    ],
    links: [['api','live','save live state'],['api','stream','queue events'],['stream','worker','process later'],['worker','postgres','commit then acknowledge'],['postgres','live','rebuild after Redis loss'],['api','assessment','submit answers'],['assessment','planned','future scoring']],
    states: ['Local recovery from PostgreSQL has been verified. Host loss protection and backups remain separate work. Scoring and educator review are not implemented.'],
  },
  review: {
    title: 'What happens after the visit',
    intro: 'The learner can submit answers today. The app does not yet calculate a score or produce an educator reviewed debrief.',
    nodes: [
      ['learner', 'Learner', 'Submits answers for the visit.', 'working'],
      ['api', 'Express API', 'Checks and accepts the assessment submission.', 'working'],
      ['postgres', 'PostgreSQL', 'Stores the unscored submission.', 'working'],
      ['score', 'Score answers', 'Compare answers with an educator approved rubric.', 'planned'],
      ['debrief', 'Give feedback', 'Show strengths, gaps, and next steps.', 'planned'],
    ],
    links: [['learner','api','submit assessment'],['api','postgres','save unscored result'],['postgres','score','future scoring'],['score','debrief','future feedback']],
    states: ['Clinical orders, exams, full rubric scoring, and educator workflows are still planned or incomplete.'],
  },
}

const detailPosition = (index) => ({ x: 20 + (index % 3) * 300, y: 30 + Math.floor(index / 3) * 210 })

export const overviewGraph = { nodes: overview, edges }

export function makeDetailGraph(sectionId) {
  const detail = detailGraphs[sectionId]
  if (!detail) return null
  const nodes = detail.nodes.map(([id, title, label, status], index) => ({
    id,
    type: 'system',
    position: detailPosition(index),
    data: { title, label, system: status === 'planned' ? 'PLANNED' : 'SYSTEM PART', status, parts: [], detail: label },
  }))
  const edges = detail.links.map(([source, target, label], index) => ({
    id: `${sectionId}-${index}`,
    source,
    target,
    label,
    type: 'smoothstep',
    markerEnd: MarkerType.ArrowClosed,
    animated: false,
  }))
  return { ...detail, nodes, edges }
}

export const stepOrder = ['sign-in', 'prepare', 'talk', 'save']
export const stepText = {
  'sign-in': 'Supabase signs the learner in. The API checks the token and visit access.',
  prepare: 'The API creates and validates a case, then stores the fixed case and live visit state.',
  talk: 'The learner asks a question. The API asks OpenAI for a patient reply using allowed case details.',
  save: 'GPTMD saves the live exchange, then a worker copies durable events to PostgreSQL.',
}
