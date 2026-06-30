/*
  Fiscal Agent mock data (frontend-only)
  --------------------------------------
  Shared data module for the Fiscal Agent mockup. The base AGENTS array is
  copied VERBATIM from FiscalAgentDirectory.js (every existing field preserved)
  and then ENRICHED with the fields real fiscal-sponsorship seekers decide on:

    - model        : sponsorship model (Model A = comprehensive / the project is
                     part of the sponsor; Model C = grantor–grantee / the project
                     is a separate entity receiving regranted funds).
    - eligibility  : who/what the sponsor will take on.
    - feeStructure : admin %, setup fee, and any annual minimum.

  NOTE (follow-up): FiscalAgentDirectory.js still defines its own inline AGENTS,
  FOCUS_AREAS and SORTS. This module is intentionally additive (a parallel agent
  owns the directory file) — a future PR should dedupe the directory to import
  from here. See PR description.
*/

export const FOCUS_AREAS = [
  'Education',
  'Arts & Culture',
  'Environment',
  'Health',
  'Youth',
  'Food Security',
  'Housing',
  'Community',
];

export const SORTS = [
  { id: 'rating', label: 'Top rated' },
  { id: 'sponsored', label: 'Most projects' },
  { id: 'feeLow', label: 'Lowest fee' },
  { id: 'name', label: 'Name (A–Z)' },
];

export const AGENTS = [
  {
    id: 'a1',
    name: 'Cedar Roots Foundation',
    location: 'Portland, OR',
    region: 'West',
    verified: true,
    rating: 4.9,
    reviews: 34,
    sponsored: 12,
    assetsManaged: '$4.2M',
    feeNum: 7,
    founded: 2014,
    website: 'cedarroots.org',
    email: 'partnerships@cedarroots.org',
    phone: '(503) 555-0142',
    responseTime: '~1 business day',
    accepting: true,
    focus: ['Environment', 'Community', 'Food Security'],
    blurb:
      'Full-service fiscal sponsorship for grassroots environmental and food-justice projects.',
    about:
      'Cedar Roots Foundation has provided comprehensive fiscal sponsorship since 2014, specializing in grassroots environmental and food-justice work across the Pacific Northwest. We handle grants administration, monthly financial reporting, and compliance so project leaders can focus on impact.',
    services: ['Grants administration', 'Monthly reporting', 'Dedicated liaison', 'Compliance & audit support'],
    projects: ['Willamette River Cleanup Coalition', 'Eastside Community Fridges', 'Cascade Seed Library'],
    model: 'Model A (Comprehensive)',
    eligibility: {
      geographies: ['Pacific Northwest', 'West Coast'],
      projectTypes: ['Environmental', 'Food justice', 'Community organizing'],
      requires501c3: false,
      notes:
        'Open to unincorporated grassroots projects with a charitable purpose. Project becomes part of Cedar Roots and operates under our 501(c)(3) status.',
    },
    feeStructure: {
      adminPct: 7,
      setupFee: 'None',
      minimumAnnual: 'None',
    },
  },
  {
    id: 'a2',
    name: 'Bright Avenue Collective',
    location: 'Austin, TX',
    region: 'South',
    verified: true,
    rating: 4.7,
    reviews: 51,
    sponsored: 28,
    assetsManaged: '$9.8M',
    feeNum: 8,
    founded: 2009,
    website: 'brightavenue.org',
    email: 'hello@brightavenue.org',
    phone: '(512) 555-0188',
    responseTime: '~2 business days',
    accepting: true,
    focus: ['Arts & Culture', 'Youth', 'Education'],
    blurb: 'Established 501(c)(3) sponsoring arts and youth education initiatives across the Southwest.',
    about:
      'Bright Avenue Collective sponsors arts and youth-education initiatives across the Southwest. With onboarding in under two weeks and a hands-on grants team, we are a frequent partner for first-time program leads and established festivals alike.',
    services: ['Fast onboarding (<2 weeks)', 'Payroll for project staff', 'Donor receipting', 'Quarterly reviews'],
    projects: ['South Austin Mural Project', 'Code & Canvas After-School', 'Teen Film Lab'],
    model: 'Model A (Comprehensive)',
    eligibility: {
      geographies: ['Texas', 'Southwest US'],
      projectTypes: ['Arts & culture', 'Youth programs', 'Education'],
      requires501c3: false,
      notes:
        'Accepts both first-time program leads and established festivals. Comprehensive model includes payroll for project staff under our employer of record.',
    },
    feeStructure: {
      adminPct: 8,
      setupFee: '$250',
      minimumAnnual: '$2,000/yr',
    },
  },
  {
    id: 'a3',
    name: 'Northwind Community Trust',
    location: 'Minneapolis, MN',
    region: 'Midwest',
    verified: false,
    rating: 4.5,
    reviews: 12,
    sponsored: 6,
    assetsManaged: '$1.1M',
    feeNum: 6,
    founded: 2019,
    website: 'northwindtrust.org',
    email: 'grants@northwindtrust.org',
    phone: '(612) 555-0119',
    responseTime: '~3 business days',
    accepting: true,
    focus: ['Housing', 'Health', 'Community'],
    blurb: 'Local trust focused on housing stability and community health pilots.',
    about:
      'Northwind Community Trust is a newer, locally focused sponsor supporting housing-stability and community-health pilots in the Twin Cities. We offer hands-on guidance for first-time grant recipients and a low administrative fee.',
    services: ['Low 6% fee', 'First-timer onboarding', 'Local funder intros', 'Basic reporting'],
    projects: ['Phillips Tenant Union', 'Northside Wellness Pop-ups'],
    model: 'Model C (Grantor–Grantee)',
    eligibility: {
      geographies: ['Minneapolis–St. Paul', 'Minnesota'],
      projectTypes: ['Housing stability', 'Community health', 'Mutual aid'],
      requires501c3: false,
      notes:
        'Best fit for locally based pilots. Under the grantor–grantee model your project stays a separate entity and receives regranted funds against an approved budget.',
    },
    feeStructure: {
      adminPct: 6,
      setupFee: 'None',
      minimumAnnual: 'None',
    },
  },
  {
    id: 'a4',
    name: 'Open Harbor Initiative',
    location: 'Boston, MA',
    region: 'Northeast',
    verified: true,
    rating: 4.8,
    reviews: 88,
    sponsored: 41,
    assetsManaged: '$15.3M',
    feeNum: 9,
    founded: 2004,
    website: 'openharbor.org',
    email: 'intake@openharbor.org',
    phone: '(617) 555-0173',
    responseTime: 'Same day',
    accepting: false,
    focus: ['Education', 'Health', 'Youth'],
    blurb: 'Large fiscal sponsor with compliance, payroll, and audit support built in.',
    about:
      'Open Harbor Initiative is one of the largest fiscal sponsors in the Northeast, with full compliance, payroll, and audit infrastructure. Ideal for multi-year, multi-funder programs that need institutional-grade administration.',
    services: ['Full compliance suite', 'Payroll & benefits', 'Annual audit', 'Multi-funder reporting'],
    projects: ['Greater Boston Literacy Network', 'Harborview Youth Clinics', 'STEM Bridges Program'],
    model: 'Model A (Comprehensive)',
    eligibility: {
      geographies: ['Northeast US', 'National (case by case)'],
      projectTypes: ['Education', 'Health', 'Youth services', 'Multi-funder programs'],
      requires501c3: false,
      notes:
        'Built for multi-year, multi-funder programs needing institutional-grade administration. Currently waitlist-only — join the queue and we will reach out as capacity opens.',
    },
    feeStructure: {
      adminPct: 9,
      setupFee: '$500',
      minimumAnnual: '$5,000/yr',
    },
  },
  {
    id: 'a5',
    name: 'Prairie Light Fund',
    location: 'Denver, CO',
    region: 'West',
    verified: false,
    rating: 4.4,
    reviews: 9,
    sponsored: 9,
    assetsManaged: '$2.0M',
    feeNum: 7.5,
    founded: 2017,
    website: 'prairielight.org',
    email: 'team@prairielight.org',
    phone: '(303) 555-0150',
    responseTime: '~2 business days',
    accepting: true,
    focus: ['Arts & Culture', 'Environment'],
    blurb: 'Boutique sponsor for emerging arts and conservation work.',
    about:
      'Prairie Light Fund is a boutique sponsor for emerging arts and conservation projects along the Front Range. We offer personalized funder reporting and quarterly check-ins with every sponsored project.',
    services: ['Personalized reporting', 'Quarterly check-ins', 'Grant-writing referrals'],
    projects: ['High Plains Land Trust Pilot', 'RiNo Artist Residency'],
    model: 'Model C (Grantor–Grantee)',
    eligibility: {
      geographies: ['Colorado Front Range', 'Mountain West'],
      projectTypes: ['Emerging arts', 'Conservation', 'Artist residencies'],
      requires501c3: false,
      notes:
        'Boutique sponsor that keeps a small roster for personalized attention. Grantor–grantee model: funds are regranted to your project against milestones.',
    },
    feeStructure: {
      adminPct: 7.5,
      setupFee: '$150',
      minimumAnnual: 'None',
    },
  },
  {
    id: 'a6',
    name: 'Unity Bridge Services',
    location: 'Atlanta, GA',
    region: 'South',
    verified: true,
    rating: 4.6,
    reviews: 27,
    sponsored: 19,
    assetsManaged: '$6.4M',
    feeNum: 8,
    founded: 2012,
    website: 'unitybridge.org',
    email: 'connect@unitybridge.org',
    phone: '(404) 555-0166',
    responseTime: '~1 business day',
    accepting: true,
    focus: ['Community', 'Food Security', 'Housing'],
    blurb: 'Regional sponsor specializing in mutual-aid and food-security networks.',
    about:
      'Unity Bridge Services specializes in mutual-aid and food-security networks across the Southeast. Our bilingual grants-administration team supports community-led programs with culturally responsive reporting.',
    services: ['Bilingual admin team', 'Mutual-aid disbursement', 'Community reporting', 'Rapid intake'],
    projects: ['Westside Food Network', 'Clarkston Newcomer Aid', 'Southside Housing Collective'],
    model: 'Model A (Comprehensive)',
    eligibility: {
      geographies: ['Georgia', 'Southeast US'],
      projectTypes: ['Mutual aid', 'Food security', 'Housing', 'Newcomer & refugee services'],
      requires501c3: false,
      notes:
        'Community-led programs welcome. Bilingual team and culturally responsive reporting; comprehensive model with rapid intake for time-sensitive funding.',
    },
    feeStructure: {
      adminPct: 8,
      setupFee: 'None',
      minimumAnnual: '$1,200/yr',
    },
  },
];

/**
 * Look up a single agent by its id. Returns the agent object, or undefined if
 * no agent matches (callers render a friendly "not found" state).
 */
export function getAgentById(id) {
  return AGENTS.find((agent) => agent.id === id);
}
