import bcrypt from 'bcryptjs';
import { ApplicationStatus, FieldType, Prisma, PrismaClient, Role, Visibility } from '@prisma/client';

const prisma = new PrismaClient();

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

async function upsertUser(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
  organization?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  return prisma.user.upsert({
    where: { email: input.email },
    update: { name: input.name, role: input.role, organization: input.organization ?? null },
    create: {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      organization: input.organization ?? null,
    },
  });
}

type SeedRequirement = {
  key: string;
  label: string;
  field_type: FieldType;
  required?: boolean;
  help_text?: string;
  options?: string[];
  validations?: Record<string, unknown>;
  file_constraints?: Record<string, unknown>;
};

async function upsertGrant(
  slug: string,
  data: Omit<Prisma.GrantCreateInput, 'slug' | 'requirements'>,
  requirements: SeedRequirement[],
) {
  const grant = await prisma.grant.upsert({
    where: { slug },
    update: data,
    create: { slug, ...data },
  });

  await Promise.all(
    requirements.map((requirement, index) =>
      prisma.requirement.upsert({
        where: { grantId_key: { grantId: grant.id, key: requirement.key } },
        update: {
          label: requirement.label,
          fieldType: requirement.field_type,
          required: requirement.required ?? true,
          helpText: requirement.help_text ?? null,
          optionsJson: requirement.options ?? Prisma.DbNull,
          validationsJson: (requirement.validations as Prisma.InputJsonValue) ?? Prisma.DbNull,
          fileConstraintsJson: (requirement.file_constraints as Prisma.InputJsonValue) ?? Prisma.DbNull,
          orderIndex: index + 1,
        },
        create: {
          grantId: grant.id,
          key: requirement.key,
          label: requirement.label,
          fieldType: requirement.field_type,
          required: requirement.required ?? true,
          helpText: requirement.help_text ?? null,
          optionsJson: requirement.options ?? Prisma.DbNull,
          validationsJson: (requirement.validations as Prisma.InputJsonValue) ?? Prisma.DbNull,
          fileConstraintsJson: (requirement.file_constraints as Prisma.InputJsonValue) ?? Prisma.DbNull,
          orderIndex: index + 1,
        },
      }),
    ),
  );

  return grant;
}

async function main() {
  const admin = await upsertUser({
    name: 'Portal Administrator',
    email: 'admin@grant-portal.local',
    password: 'Admin12345!',
    role: Role.admin,
  });
  const reviewer = await upsertUser({
    name: 'Rena Reviewer',
    email: 'reviewer@grant-portal.local',
    password: 'Review12345!',
    role: Role.reviewer,
  });
  const applicant = await upsertUser({
    name: 'Alex Applicant',
    email: 'applicant@grant-portal.local',
    password: 'Apply12345!',
    role: Role.applicant,
    organization: 'Community Builders Foundation',
  });
  const secondApplicant = await upsertUser({
    name: 'Sam Seeker',
    email: 'sam@grant-portal.local',
    password: 'Apply12345!',
    role: Role.applicant,
    organization: 'Green Roots Collective',
  });

  const youth = await upsertGrant(
    'youth-innovation-micro-grant',
    {
      title: 'Youth Innovation Micro-Grant',
      description:
        'Seed grants for youth-led initiatives with measurable social impact. Funding supports pilot projects, ' +
        'materials and coaching over a twelve-month period.',
      maxAmount: new Prisma.Decimal(5000),
      currency: 'EUR',
      deadline: days(30),
      openAt: days(-14),
      targetGroups: ['Youth', 'Community'],
      eligibility: 'NGOs, community groups and individuals aged 16–30 based in the EU.',
      expectedImpact: 'Local community engagement with measurable outcomes within 12 months.',
      visibility: Visibility.public,
      createdBy: { connect: { id: admin.id } },
    },
    [
      { key: 'org_name', label: 'Organization / applicant name', field_type: FieldType.text },
      {
        key: 'proposal',
        label: 'Project proposal',
        field_type: FieldType.textarea,
        help_text: 'Describe the goals, timeline and activities of your project.',
        validations: { minLength: 200, maxLength: 5000 },
      },
      {
        key: 'budget',
        label: 'Requested budget (EUR)',
        field_type: FieldType.currency,
        validations: { min: 500, max: 5000 },
      },
      { key: 'impact', label: 'Expected impact', field_type: FieldType.textarea, validations: { minLength: 100 } },
      {
        key: 'category',
        label: 'Category',
        field_type: FieldType.select,
        options: ['Education', 'Health', 'Environment', 'Arts'],
      },
      {
        key: 'start_date',
        label: 'Planned start date',
        field_type: FieldType.date,
        required: false,
      },
      {
        key: 'website',
        label: 'Website or social media',
        field_type: FieldType.url,
        required: false,
      },
      {
        key: 'budget_sheet',
        label: 'Detailed budget (PDF or spreadsheet)',
        field_type: FieldType.file,
        file_constraints: { maxMB: 10, mimetypes: ['application/pdf', 'application/vnd.ms-excel'] },
      },
      {
        key: 'agree',
        label: 'I certify that the information provided is correct',
        field_type: FieldType.checkbox,
      },
    ],
  );

  await upsertGrant(
    'community-climate-fund',
    {
      title: 'Community Climate Fund',
      description:
        'Support for neighbourhood-level climate adaptation: greening, water retention, circular initiatives and ' +
        'energy cooperatives.',
      maxAmount: new Prisma.Decimal(25000),
      currency: 'EUR',
      deadline: days(75),
      openAt: days(-3),
      targetGroups: ['Community', 'Environment', 'Cooperatives'],
      eligibility: 'Registered associations, foundations and cooperatives with at least one year of activity.',
      expectedImpact: 'Measurable CO₂ reduction or climate resilience for at least 250 residents.',
      visibility: Visibility.public,
      createdBy: { connect: { id: admin.id } },
    },
    [
      { key: 'org_name', label: 'Organization name', field_type: FieldType.text },
      { key: 'registration_number', label: 'Chamber of commerce number', field_type: FieldType.text },
      {
        key: 'themes',
        label: 'Themes addressed',
        field_type: FieldType.multiselect,
        options: ['Greening', 'Water', 'Energy', 'Circular economy', 'Mobility'],
      },
      { key: 'summary', label: 'Project summary', field_type: FieldType.textarea, validations: { maxLength: 3000 } },
      { key: 'amount', label: 'Requested amount (EUR)', field_type: FieldType.currency, validations: { min: 2500, max: 25000 } },
      { key: 'residents', label: 'Residents reached', field_type: FieldType.number, validations: { min: 250 } },
      { key: 'project_plan', label: 'Project plan (PDF)', field_type: FieldType.file, file_constraints: { maxMB: 15 } },
      { key: 'annual_report', label: 'Most recent annual report', field_type: FieldType.file, required: false },
      { key: 'agree', label: 'I agree to the fund conditions', field_type: FieldType.checkbox },
    ],
  );

  await upsertGrant(
    'research-fellowship-2026',
    {
      title: 'Applied Research Fellowship 2026',
      description: 'Twelve-month fellowships for applied research with a societal partner. Opens later this year.',
      maxAmount: new Prisma.Decimal(60000),
      currency: 'EUR',
      deadline: days(160),
      openAt: days(45),
      targetGroups: ['Researchers', 'Universities'],
      eligibility: 'Researchers holding a PhD awarded no more than eight years ago.',
      expectedImpact: 'Peer-reviewed publication plus a practical deliverable for the partner organization.',
      visibility: Visibility.public,
      createdBy: { connect: { id: admin.id } },
    },
    [
      { key: 'org_name', label: 'Host institution', field_type: FieldType.text },
      { key: 'abstract', label: 'Research abstract', field_type: FieldType.textarea, validations: { maxLength: 2500 } },
      { key: 'partner', label: 'Societal partner', field_type: FieldType.text },
      { key: 'amount', label: 'Requested amount (EUR)', field_type: FieldType.currency, validations: { min: 10000, max: 60000 } },
      { key: 'cv', label: 'Curriculum vitae (PDF)', field_type: FieldType.file },
      { key: 'agree', label: 'I confirm the host institution supports this application', field_type: FieldType.checkbox },
    ],
  );

  // A submitted application so the admin dashboard is not empty on first run.
  const requirements = await prisma.requirement.findMany({ where: { grantId: youth.id } });
  const byKey = new Map(requirements.map((r) => [r.key, r]));

  const application = await prisma.application.upsert({
    where: { userId_grantId: { userId: applicant.id, grantId: youth.id } },
    update: {},
    create: {
      userId: applicant.id,
      grantId: youth.id,
      status: ApplicationStatus.submitted,
      submittedAt: days(-2),
    },
  });

  const answers: Record<string, { valueText?: string; valueNumber?: Prisma.Decimal; valueJson?: Prisma.InputJsonValue }> = {
    org_name: { valueText: 'Community Builders Foundation' },
    proposal: {
      valueText:
        'We run a twelve-week programme where sixty young people from three neighbourhoods design and build a ' +
        'shared repair café. Participants learn practical repair skills, basic bookkeeping and how to run a ' +
        'community space. The pilot starts in March with two coaches and ends with a public opening where the ' +
        'café is handed over to a youth-led board that keeps it running.',
    },
    budget: { valueNumber: new Prisma.Decimal(4800) },
    impact: {
      valueText:
        'Sixty participants gain certified repair skills, an estimated 1,200 items are repaired instead of ' +
        'discarded in the first year, and the neighbourhood gains a permanent meeting place run by young people.',
    },
    category: { valueText: 'Environment' },
    agree: { valueJson: true },
  };

  for (const [key, value] of Object.entries(answers)) {
    const requirement = byKey.get(key);
    if (!requirement) continue;
    await prisma.applicationResponse.upsert({
      where: { applicationId_requirementId: { applicationId: application.id, requirementId: requirement.id } },
      update: value,
      create: { applicationId: application.id, requirementId: requirement.id, ...value },
    });
  }

  await prisma.review.upsert({
    where: { applicationId_reviewerId: { applicationId: application.id, reviewerId: reviewer.id } },
    update: {},
    create: {
      applicationId: application.id,
      reviewerId: reviewer.id,
      score: new Prisma.Decimal(78),
      recommendation: 'approve',
      notes: 'Strong community anchoring and a realistic budget. Ask for a clearer maintenance plan after year one.',
    },
  });

  // A second applicant with a half-finished draft.
  await prisma.application.upsert({
    where: { userId_grantId: { userId: secondApplicant.id, grantId: youth.id } },
    update: {},
    create: { userId: secondApplicant.id, grantId: youth.id, status: ApplicationStatus.draft },
  });

  // eslint-disable-next-line no-console
  console.log(`Seed complete.

  Admin     admin@grant-portal.local      / Admin12345!
  Reviewer  reviewer@grant-portal.local   / Review12345!
  Applicant applicant@grant-portal.local  / Apply12345!
  Applicant sam@grant-portal.local        / Apply12345!
`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
