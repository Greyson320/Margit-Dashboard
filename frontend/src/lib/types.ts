export type Role = 'applicant' | 'admin' | 'reviewer';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'file'
  | 'url'
  | 'currency';

export const FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'file',
  'url',
];

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export type Visibility = 'public' | 'internal' | 'archived';

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  organization: string | null;
};

export type Validations = {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  requiredIf?: { key: string; equals: unknown };
};

export type Requirement = {
  id: string;
  grantId?: string;
  key: string;
  label: string;
  fieldType: FieldType;
  helpText: string | null;
  required: boolean;
  optionsJson: string[] | null;
  validationsJson: Validations | null;
  fileConstraintsJson: { mimetypes?: string[]; maxMB?: number } | null;
  orderIndex: number;
};

export type Grant = {
  id: string;
  title: string;
  slug: string;
  description: string;
  maxAmount: number | null;
  currency: string;
  deadline: string | null;
  openAt: string | null;
  targetGroups: string[] | null;
  eligibility: string | null;
  expectedImpact: string | null;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  requirements: Requirement[];
  application_count: number;
  is_open: boolean;
  state: 'open' | 'closed' | 'upcoming' | 'archived';
  my_application?: { id: string; status: ApplicationStatus; submittedAt: string | null } | null;
};

export type Review = {
  id: string;
  applicationId: string;
  reviewerId: string;
  score: number | null;
  notes: string | null;
  recommendation: 'approve' | 'reject' | 'needs_more_info' | null;
  createdAt: string;
  updatedAt: string;
  reviewer: { id: string; name: string; email: string };
};

export type Progress = {
  total: number;
  completed: number;
  requiredTotal: number;
  requiredCompleted: number;
  percent: number;
  missing: string[];
};

export type ValidationIssue = { key: string; label: string; message: string };

export type UploadedFile = {
  id: string;
  filename: string;
  size_bytes: string;
  mimetype: string;
};

export type FieldValue = string | number | boolean | string[] | null;

export type ApplicationDetail = {
  id: string;
  status: ApplicationStatus;
  status_label: string;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  applicant: { id: string; name: string; email: string; organization: string | null };
  grant: {
    id: string;
    title: string;
    slug: string;
    description: string;
    deadline: string | null;
    currency: string;
    max_amount: number | null;
    requirements: Requirement[];
  };
  reviews: Review[];
  values: Record<string, FieldValue>;
  files: Record<string, UploadedFile | null>;
  progress: Progress;
  average_score: number | null;
  allowed_transitions: ApplicationStatus[];
  validation_issues: ValidationIssue[];
};

export type ApplicationSummary = {
  id: string;
  status: ApplicationStatus;
  status_label: string;
  submitted_at: string | null;
  updated_at: string;
  created_at: string;
  grant: { id: string; title: string; slug: string; deadline: string | null };
  applicant: { id: string; name: string; email: string; organization: string | null };
  review_count: number;
};

export type Notification = {
  id: string;
  subject: string;
  body: string;
  channel: 'email' | 'in_app';
  readAt: string | null;
  createdAt: string;
};

export type StatsOverview = {
  applications: {
    total: number;
    last_30_days: number;
    by_status: Record<ApplicationStatus, number>;
    approval_rate: number | null;
    awaiting_decision: number;
  };
  grants: {
    total: number;
    open: number;
    total_budget: number | null;
    closing_soon: { id: string; title: string; deadline: string; application_count: number }[];
  };
  applicants: number;
  per_grant: { grant_id: string; title: string; total: number; by_status: Record<string, number> }[];
};

export type Paginated<T> = { items: T[]; total: number; take: number; skip: number };

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  organization: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { applications: number };
};

export type AuditEntry = {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  payloadJson: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};
