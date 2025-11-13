# Phase 7: Automated Workflows & Approval Systems

## Overview

Phase 7 builds upon the duplicate detection, merge, correlation, and quality metrics capabilities from Phase 6 to create intelligent, automated workflows for deal registration processing, validation, and approval.

### Goals

1. **Automated Deal Processing Pipeline**: End-to-end automation from file upload to approval
2. **Intelligent Routing**: Rule-based and AI-powered decision making
3. **Approval Workflows**: Multi-level approval chains with SLA tracking
4. **Notification System**: Real-time alerts and escalations
5. **Audit & Compliance**: Complete tracking of all workflow actions

### Dependencies

- ✅ Phase 4: AI Extraction & Validation
- ✅ Phase 5: Vendor Matching & Aliases
- ✅ Phase 6: Duplicate Detection, Merge, Correlation, Quality Metrics

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Engine                          │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Rule Engine    │  │ State Machine  │  │ Task Queue   │  │
│  │ - Conditions   │  │ - Transitions  │  │ - Bull/Redis │  │
│  │ - Actions      │  │ - Validations  │  │ - Retry Logic│  │
│  └────────────────┘  └────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Approval System                           │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Approval Chains│  │ SLA Tracking   │  │ Auto-approve │  │
│  │ - Multi-level  │  │ - Timeouts     │  │ - Thresholds │  │
│  │ - Parallel     │  │ - Escalation   │  │ - Rules      │  │
│  └────────────────┘  └────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 Notification System                         │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Email          │  │ Webhooks       │  │ In-App       │  │
│  │ Slack/Teams    │  │ Real-time      │  │ Dashboard    │  │
│  └────────────────┘  └────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Phase 7.1: Workflow Engine

### Workflow State Machine

**States**:
- `uploaded` - File received
- `parsing` - File being parsed
- `extracted` - AI extraction complete
- `validating` - Running validation rules
- `duplicate_check` - Checking for duplicates
- `duplicate_found` - Duplicates detected, awaiting resolution
- `quality_check` - Quality score calculation
- `routing` - Determining approval path
- `pending_approval` - Awaiting approval decision
- `approved` - Deal approved
- `rejected` - Deal rejected
- `on_hold` - Deal on hold for review
- `archived` - Deal archived
- `error` - Processing error

**Transitions**:
```typescript
const WORKFLOW_TRANSITIONS = {
  uploaded: ['parsing', 'error'],
  parsing: ['extracted', 'error'],
  extracted: ['validating', 'error'],
  validating: ['duplicate_check', 'rejected', 'error'],
  duplicate_check: ['duplicate_found', 'quality_check', 'error'],
  duplicate_found: ['quality_check', 'archived', 'error'],
  quality_check: ['routing', 'on_hold', 'error'],
  routing: ['pending_approval', 'approved', 'rejected', 'error'],
  pending_approval: ['approved', 'rejected', 'on_hold', 'error'],
  approved: ['archived'],
  rejected: ['archived'],
  on_hold: ['validating', 'pending_approval', 'archived'],
  error: ['uploaded', 'archived']
};
```

### Workflow Rules Engine

```typescript
export interface WorkflowRule {
  id: string;
  name: string;
  description: string;
  triggerEvent: WorkflowEvent;
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'matches' | 'in' | 'not_in';
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

export interface RuleAction {
  type: 'transition_state' | 'assign_approver' | 'send_notification' | 'set_field' | 'create_task' | 'call_webhook';
  parameters: Record<string, any>;
}

export enum WorkflowEvent {
  FILE_UPLOADED = 'file_uploaded',
  EXTRACTION_COMPLETE = 'extraction_complete',
  VALIDATION_COMPLETE = 'validation_complete',
  DUPLICATE_DETECTED = 'duplicate_detected',
  QUALITY_SCORED = 'quality_scored',
  APPROVAL_REQUESTED = 'approval_requested',
  APPROVAL_GRANTED = 'approval_granted',
  APPROVAL_DENIED = 'approval_denied',
  SLA_WARNING = 'sla_warning',
  SLA_BREACH = 'sla_breach'
}
```

### Implementation Files

**File**: `backend/src/services/workflowEngine.ts` (~1,200 lines)

Key functions:
```typescript
// Initialize workflow for new entity
async function createWorkflowInstance(
  entityType: 'deal' | 'vendor' | 'contact',
  entityId: string,
  initialState: WorkflowState = 'uploaded',
  metadata?: Record<string, any>
): Promise<WorkflowInstance>

// Transition workflow state
async function transitionWorkflow(
  workflowId: string,
  targetState: WorkflowState,
  actionBy: string,
  notes?: string
): Promise<WorkflowInstance>

// Evaluate rules for current workflow state
async function evaluateRules(
  workflowId: string,
  event: WorkflowEvent
): Promise<RuleEvaluationResult>

// Execute rule actions
async function executeActions(
  workflowId: string,
  actions: RuleAction[]
): Promise<ActionExecutionResult[]>

// Get workflow history
async function getWorkflowHistory(
  workflowId: string
): Promise<WorkflowStateChange[]>

// Get active workflows
async function getActiveWorkflows(
  filters?: {
    state?: WorkflowState;
    entityType?: string;
    assignedTo?: string;
  }
): Promise<WorkflowInstance[]>

// Bulk transition workflows
async function bulkTransitionWorkflows(
  workflowIds: string[],
  targetState: WorkflowState,
  actionBy: string
): Promise<BulkTransitionResult>
```

**File**: `backend/src/db/migrations/015_workflows.sql` (~600 lines)

Tables:
```sql
-- Workflow instances
CREATE TABLE workflow_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  current_state VARCHAR(50) NOT NULL,
  previous_state VARCHAR(50),
  assigned_to UUID REFERENCES users(id),
  priority INTEGER DEFAULT 3, -- 1=highest, 5=lowest
  sla_deadline TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Workflow state changes (audit trail)
CREATE TABLE workflow_state_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
  from_state VARCHAR(50),
  to_state VARCHAR(50) NOT NULL,
  changed_by UUID REFERENCES users(id),
  change_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow rules
CREATE TABLE workflow_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  trigger_event VARCHAR(100) NOT NULL,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  priority INTEGER DEFAULT 100,
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rule execution log
CREATE TABLE workflow_rule_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES workflow_rules(id),
  event VARCHAR(100) NOT NULL,
  conditions_met BOOLEAN NOT NULL,
  actions_executed JSONB,
  execution_time_ms INTEGER,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow tasks
CREATE TABLE workflow_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
  task_type VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending',
  due_date TIMESTAMP,
  completed_at TIMESTAMP,
  completed_by UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_workflows_entity ON workflow_instances(entity_type, entity_id);
CREATE INDEX idx_workflows_state ON workflow_instances(current_state);
CREATE INDEX idx_workflows_assigned ON workflow_instances(assigned_to);
CREATE INDEX idx_workflows_sla ON workflow_instances(sla_deadline) WHERE completed_at IS NULL;
CREATE INDEX idx_state_changes_workflow ON workflow_state_changes(workflow_id);
CREATE INDEX idx_tasks_workflow ON workflow_tasks(workflow_id);
CREATE INDEX idx_tasks_assigned ON workflow_tasks(assigned_to, status);
```

Views:
```sql
-- Active workflows with SLA status
CREATE VIEW active_workflows_with_sla AS
SELECT
  wi.*,
  CASE
    WHEN wi.sla_deadline IS NULL THEN 'no_sla'
    WHEN wi.sla_deadline < CURRENT_TIMESTAMP THEN 'breached'
    WHEN wi.sla_deadline < CURRENT_TIMESTAMP + INTERVAL '4 hours' THEN 'warning'
    ELSE 'ok'
  END as sla_status,
  EXTRACT(EPOCH FROM (wi.sla_deadline - CURRENT_TIMESTAMP)) / 3600 as hours_until_sla,
  u.email as assigned_to_email,
  u.name as assigned_to_name
FROM workflow_instances wi
LEFT JOIN users u ON wi.assigned_to = u.id
WHERE wi.completed_at IS NULL;

-- Workflow performance metrics
CREATE VIEW workflow_metrics AS
SELECT
  entity_type,
  current_state,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, CURRENT_TIMESTAMP) - created_at))) / 3600 as avg_hours,
  COUNT(CASE WHEN sla_deadline < completed_at THEN 1 END) as sla_breaches
FROM workflow_instances
GROUP BY entity_type, current_state;

-- Pending approvals
CREATE VIEW pending_approvals AS
SELECT
  wi.*,
  d.deal_name,
  d.customer_name,
  d.deal_value,
  d.currency
FROM workflow_instances wi
JOIN deals d ON wi.entity_id = d.id AND wi.entity_type = 'deal'
WHERE wi.current_state = 'pending_approval'
  AND wi.completed_at IS NULL;
```

**File**: `backend/src/routes/workflows.ts` (~800 lines)

Endpoints:
- `POST /api/workflows/create` - Create workflow instance
- `POST /api/workflows/:id/transition` - Transition state
- `GET /api/workflows/:id` - Get workflow details
- `GET /api/workflows/:id/history` - Get state change history
- `GET /api/workflows` - List workflows with filters
- `GET /api/workflows/active` - Get active workflows
- `GET /api/workflows/assigned-to-me` - Get user's assigned workflows
- `GET /api/workflows/sla-breached` - Get SLA breached workflows
- `POST /api/workflows/rules` - Create workflow rule
- `GET /api/workflows/rules` - List all rules
- `PUT /api/workflows/rules/:id` - Update rule
- `DELETE /api/workflows/rules/:id` - Delete rule
- `GET /api/workflows/metrics` - Get workflow metrics
- `POST /api/workflows/bulk-transition` - Bulk state transition

## Phase 7.2: Approval System

### Approval Chain Configuration

```typescript
export interface ApprovalChain {
  id: string;
  name: string;
  description: string;
  entityType: 'deal' | 'vendor' | 'contact';
  levels: ApprovalLevel[];
  autoApprovalRules?: AutoApprovalRule[];
  slaHours: number;
  escalationEnabled: boolean;
  escalationHours: number;
  enabled: boolean;
}

export interface ApprovalLevel {
  level: number;
  name: string;
  approvers: ApproverConfig[];
  requireAll: boolean; // true = all must approve, false = any can approve
  slaHours: number;
  autoEscalate: boolean;
  conditions?: RuleCondition[]; // Optional conditions to skip this level
}

export interface ApproverConfig {
  type: 'user' | 'role' | 'dynamic';
  userId?: string;
  roleId?: string;
  dynamicRule?: string; // e.g., "deal.sales_rep.manager"
}

export interface AutoApprovalRule {
  name: string;
  conditions: RuleCondition[];
  description: string;
  enabled: boolean;
}

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  entityType: string;
  entityId: string;
  approvalChainId: string;
  currentLevel: number;
  totalLevels: number;
  status: 'pending' | 'approved' | 'rejected' | 'escalated' | 'auto_approved';
  requestedBy: string;
  requestedAt: Date;
  dueAt: Date;
  completedAt?: Date;
}

export interface ApprovalDecision {
  approvalRequestId: string;
  level: number;
  approverId: string;
  decision: 'approve' | 'reject' | 'request_changes';
  comments?: string;
  decidedAt: Date;
}
```

### Auto-Approval Logic

```typescript
// Auto-approve if quality score high and no duplicates
const highQualityAutoApproval: AutoApprovalRule = {
  name: 'High Quality Auto-Approval',
  conditions: [
    { field: 'quality_score', operator: 'greater_than', value: 90 },
    { field: 'has_duplicates', operator: 'equals', value: false },
    { field: 'validation_errors', operator: 'equals', value: 0 },
    { field: 'deal_value', operator: 'less_than', value: 10000 }
  ],
  description: 'Auto-approve deals with >90% quality, no duplicates, no errors, and value <$10k',
  enabled: true
};

// Auto-approve if vendor is pre-approved
const preApprovedVendorRule: AutoApprovalRule = {
  name: 'Pre-Approved Vendor Auto-Approval',
  conditions: [
    { field: 'vendor.approval_status', operator: 'equals', value: 'pre_approved' },
    { field: 'deal_value', operator: 'less_than', value: 50000 }
  ],
  description: 'Auto-approve deals with pre-approved vendors under $50k',
  enabled: true
};
```

### Implementation Files

**File**: `backend/src/services/approvalSystem.ts` (~1,000 lines)

Key functions:
```typescript
// Request approval for entity
async function requestApproval(
  workflowId: string,
  approvalChainId: string,
  requestedBy: string,
  context?: Record<string, any>
): Promise<ApprovalRequest>

// Check auto-approval rules
async function checkAutoApproval(
  entityId: string,
  entityType: string,
  approvalChainId: string
): Promise<{ autoApprove: boolean; matchedRule?: AutoApprovalRule }>

// Submit approval decision
async function submitApprovalDecision(
  approvalRequestId: string,
  approverId: string,
  decision: 'approve' | 'reject' | 'request_changes',
  comments?: string
): Promise<ApprovalDecision>

// Process approval (move to next level or complete)
async function processApprovalDecision(
  approvalRequestId: string,
  decision: ApprovalDecision
): Promise<ApprovalRequest>

// Escalate overdue approvals
async function escalateOverdueApprovals(): Promise<EscalationResult[]>

// Get pending approvals for user
async function getPendingApprovalsForUser(
  userId: string,
  filters?: {
    entityType?: string;
    priority?: number;
  }
): Promise<ApprovalRequest[]>

// Get approval history
async function getApprovalHistory(
  entityId: string,
  entityType: string
): Promise<ApprovalDecision[]>

// Reassign approval
async function reassignApproval(
  approvalRequestId: string,
  level: number,
  fromUserId: string,
  toUserId: string,
  reason: string
): Promise<ApprovalRequest>
```

**File**: `backend/src/db/migrations/016_approvals.sql` (~500 lines)

Tables:
```sql
-- Approval chains configuration
CREATE TABLE approval_chains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  entity_type VARCHAR(50) NOT NULL,
  levels JSONB NOT NULL,
  auto_approval_rules JSONB DEFAULT '[]',
  sla_hours INTEGER NOT NULL DEFAULT 48,
  escalation_enabled BOOLEAN DEFAULT true,
  escalation_hours INTEGER DEFAULT 24,
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Approval requests
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  approval_chain_id UUID REFERENCES approval_chains(id),
  current_level INTEGER NOT NULL DEFAULT 1,
  total_levels INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  requested_by UUID REFERENCES users(id),
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  due_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  auto_approved BOOLEAN DEFAULT false,
  auto_approval_rule TEXT
);

-- Approval decisions
CREATE TABLE approval_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_request_id UUID REFERENCES approval_requests(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  approver_id UUID REFERENCES users(id) NOT NULL,
  decision VARCHAR(50) NOT NULL,
  comments TEXT,
  decided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Approval escalations
CREATE TABLE approval_escalations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_request_id UUID REFERENCES approval_requests(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  original_approver_id UUID REFERENCES users(id),
  escalated_to_id UUID REFERENCES users(id),
  reason VARCHAR(200),
  escalated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_approval_requests_workflow ON approval_requests(workflow_id);
CREATE INDEX idx_approval_requests_entity ON approval_requests(entity_type, entity_id);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);
CREATE INDEX idx_approval_decisions_request ON approval_decisions(approval_request_id);
CREATE INDEX idx_approval_decisions_approver ON approval_decisions(approver_id);
```

**File**: `backend/src/routes/approvals.ts` (~700 lines)

Endpoints:
- `POST /api/approvals/request` - Request approval
- `POST /api/approvals/:id/decide` - Submit approval decision
- `GET /api/approvals/:id` - Get approval request details
- `GET /api/approvals/pending` - Get all pending approvals
- `GET /api/approvals/my-pending` - Get user's pending approvals
- `GET /api/approvals/history/:entityId` - Get approval history
- `POST /api/approvals/:id/reassign` - Reassign approval
- `POST /api/approvals/escalate` - Manually escalate approval
- `POST /api/approvals/chains` - Create approval chain
- `GET /api/approvals/chains` - List approval chains
- `PUT /api/approvals/chains/:id` - Update approval chain
- `GET /api/approvals/metrics` - Get approval metrics

## Phase 7.3: Notification System

### Notification Types

```typescript
export enum NotificationType {
  // Workflow notifications
  WORKFLOW_CREATED = 'workflow_created',
  WORKFLOW_ASSIGNED = 'workflow_assigned',
  WORKFLOW_STATE_CHANGED = 'workflow_state_changed',
  WORKFLOW_COMPLETED = 'workflow_completed',
  WORKFLOW_ERROR = 'workflow_error',

  // Approval notifications
  APPROVAL_REQUESTED = 'approval_requested',
  APPROVAL_GRANTED = 'approval_granted',
  APPROVAL_DENIED = 'approval_denied',
  APPROVAL_ESCALATED = 'approval_escalated',
  APPROVAL_REASSIGNED = 'approval_reassigned',

  // SLA notifications
  SLA_WARNING = 'sla_warning',
  SLA_BREACH = 'sla_breach',

  // Duplicate notifications
  DUPLICATE_DETECTED = 'duplicate_detected',
  DUPLICATE_MERGED = 'duplicate_merged',

  // Quality notifications
  QUALITY_ISSUE_DETECTED = 'quality_issue_detected',
  QUALITY_THRESHOLD_BREACH = 'quality_threshold_breach',

  // System notifications
  SYSTEM_ALERT = 'system_alert',
  BATCH_COMPLETE = 'batch_complete'
}

export interface NotificationChannel {
  type: 'email' | 'slack' | 'teams' | 'webhook' | 'in_app' | 'sms';
  enabled: boolean;
  config: Record<string, any>;
}

export interface NotificationTemplate {
  id: string;
  notificationType: NotificationType;
  channel: NotificationChannel['type'];
  subject: string; // Template string
  body: string; // Template string with {{variables}}
  priority: 'low' | 'medium' | 'high' | 'urgent';
  enabled: boolean;
}

export interface Notification {
  id: string;
  type: NotificationType;
  recipientId: string;
  channel: NotificationChannel['type'];
  subject: string;
  body: string;
  metadata: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'sent' | 'failed' | 'read';
  sentAt?: Date;
  readAt?: Date;
  error?: string;
  createdAt: Date;
}
```

### Notification Rules

```typescript
// Notify approver when approval is requested
const approvalRequestedNotification = {
  trigger: NotificationType.APPROVAL_REQUESTED,
  channels: ['email', 'in_app', 'slack'],
  recipients: ['approver'],
  template: {
    subject: 'Approval Required: {{deal_name}}',
    body: `
You have a new approval request:

Deal: {{deal_name}}
Customer: {{customer_name}}
Value: {{deal_value}} {{currency}}
Priority: {{priority}}

Please review and approve/reject by {{due_date}}.

[Approve] [Reject] [View Details]
    `
  }
};

// Notify on SLA warning
const slaWarningNotification = {
  trigger: NotificationType.SLA_WARNING,
  channels: ['email', 'slack'],
  recipients: ['assigned_user', 'manager'],
  template: {
    subject: 'SLA Warning: {{deal_name}} - {{hours_remaining}}h remaining',
    body: `
⚠️ SLA Warning

Deal "{{deal_name}}" is approaching its SLA deadline.

Time remaining: {{hours_remaining}} hours
Due: {{sla_deadline}}
Current state: {{current_state}}

Please take action to avoid SLA breach.
    `
  }
};
```

### Implementation Files

**File**: `backend/src/services/notificationService.ts` (~800 lines)

Key functions:
```typescript
// Send notification
async function sendNotification(
  notificationType: NotificationType,
  recipientId: string,
  data: Record<string, any>,
  channels?: NotificationChannel['type'][]
): Promise<Notification[]>

// Send email notification
async function sendEmailNotification(
  to: string,
  subject: string,
  body: string,
  metadata?: Record<string, any>
): Promise<void>

// Send Slack notification
async function sendSlackNotification(
  channel: string,
  message: string,
  metadata?: Record<string, any>
): Promise<void>

// Send webhook notification
async function sendWebhookNotification(
  url: string,
  payload: Record<string, any>
): Promise<void>

// Create in-app notification
async function createInAppNotification(
  userId: string,
  type: NotificationType,
  subject: string,
  body: string,
  metadata?: Record<string, any>
): Promise<Notification>

// Get user notifications
async function getUserNotifications(
  userId: string,
  filters?: {
    unreadOnly?: boolean;
    type?: NotificationType;
    priority?: string;
  }
): Promise<Notification[]>

// Mark notification as read
async function markAsRead(
  notificationId: string,
  userId: string
): Promise<Notification>

// Bulk mark as read
async function markAllAsRead(userId: string): Promise<number>

// Get notification preferences
async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences>

// Update notification preferences
async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<NotificationPreferences>
): Promise<NotificationPreferences>
```

**File**: `backend/src/db/migrations/017_notifications.sql` (~400 lines)

Tables:
```sql
-- Notification templates
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_type VARCHAR(100) NOT NULL,
  channel VARCHAR(50) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'medium',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(100) NOT NULL,
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  priority VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(20) DEFAULT 'pending',
  sent_at TIMESTAMP,
  read_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User notification preferences
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  email_enabled BOOLEAN DEFAULT true,
  slack_enabled BOOLEAN DEFAULT false,
  in_app_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,
  notification_types JSONB DEFAULT '{}', -- Per-type preferences
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone VARCHAR(50) DEFAULT 'UTC',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, status);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
```

**File**: `backend/src/routes/notifications.ts` (~500 lines)

Endpoints:
- `GET /api/notifications` - Get user's notifications
- `GET /api/notifications/unread` - Get unread notifications
- `POST /api/notifications/:id/read` - Mark as read
- `POST /api/notifications/read-all` - Mark all as read
- `DELETE /api/notifications/:id` - Delete notification
- `GET /api/notifications/preferences` - Get notification preferences
- `PUT /api/notifications/preferences` - Update preferences
- `POST /api/notifications/test` - Send test notification
- `GET /api/notifications/templates` - List templates
- `PUT /api/notifications/templates/:id` - Update template

## Phase 7.4: Background Jobs & Automation

### Job Queue Configuration

```typescript
import Bull from 'bull';

// Job types
export enum JobType {
  // Workflow jobs
  PROCESS_UPLOADED_FILE = 'process_uploaded_file',
  RUN_DUPLICATE_DETECTION = 'run_duplicate_detection',
  CALCULATE_QUALITY_SCORE = 'calculate_quality_score',

  // Approval jobs
  CHECK_SLA_DEADLINES = 'check_sla_deadlines',
  ESCALATE_APPROVALS = 'escalate_approvals',
  SEND_APPROVAL_REMINDERS = 'send_approval_reminders',

  // Notification jobs
  SEND_NOTIFICATION = 'send_notification',
  SEND_BATCH_NOTIFICATIONS = 'send_batch_notifications',

  // Maintenance jobs
  ARCHIVE_OLD_WORKFLOWS = 'archive_old_workflows',
  CLEANUP_OLD_NOTIFICATIONS = 'cleanup_old_notifications',
  GENERATE_DAILY_REPORT = 'generate_daily_report',

  // Auto-merge jobs
  AUTO_MERGE_HIGH_CONFIDENCE = 'auto_merge_high_confidence'
}

// Queue configuration
const workflowQueue = new Bull('workflow', {
  redis: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100,
    removeOnFail: 1000
  }
});

const notificationQueue = new Bull('notifications', {
  redis: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
});
```

### Scheduled Jobs

```typescript
// Run every hour: Check SLA deadlines
workflowQueue.add(
  JobType.CHECK_SLA_DEADLINES,
  {},
  {
    repeat: { cron: '0 * * * *' } // Every hour
  }
);

// Run every 4 hours: Send approval reminders
workflowQueue.add(
  JobType.SEND_APPROVAL_REMINDERS,
  {},
  {
    repeat: { cron: '0 */4 * * *' } // Every 4 hours
  }
);

// Run daily at 2 AM: Archive old workflows
workflowQueue.add(
  JobType.ARCHIVE_OLD_WORKFLOWS,
  { daysOld: 90 },
  {
    repeat: { cron: '0 2 * * *' } // Daily at 2 AM
  }
);

// Run daily at 8 AM: Generate daily report
workflowQueue.add(
  JobType.GENERATE_DAILY_REPORT,
  {},
  {
    repeat: { cron: '0 8 * * *' } // Daily at 8 AM
  }
);

// Run every 6 hours: Auto-merge high confidence duplicates
workflowQueue.add(
  JobType.AUTO_MERGE_HIGH_CONFIDENCE,
  { threshold: 0.95 },
  {
    repeat: { cron: '0 */6 * * *' } // Every 6 hours
  }
);
```

### Implementation Files

**File**: `backend/src/workers/workflowJobs.ts` (~600 lines)

Job processors:
```typescript
// Process uploaded file through entire pipeline
workflowQueue.process(JobType.PROCESS_UPLOADED_FILE, async (job) => {
  const { fileId } = job.data;

  // 1. Parse file
  await parseFile(fileId);

  // 2. Extract entities with AI
  await extractEntities(fileId);

  // 3. Run validation
  await validateEntities(fileId);

  // 4. Check for duplicates
  await checkDuplicates(fileId);

  // 5. Calculate quality scores
  await calculateQualityScores(fileId);

  // 6. Route to approval
  await routeForApproval(fileId);

  return { success: true, fileId };
});

// Check SLA deadlines and send warnings
workflowQueue.process(JobType.CHECK_SLA_DEADLINES, async (job) => {
  const warningThresholdHours = 4;

  const workflows = await getWorkflowsNearingSLA(warningThresholdHours);

  for (const workflow of workflows) {
    await sendNotification(
      NotificationType.SLA_WARNING,
      workflow.assigned_to,
      {
        workflowId: workflow.id,
        hoursRemaining: calculateHoursRemaining(workflow.sla_deadline),
        dealName: workflow.metadata.dealName
      }
    );
  }

  return { workflowsProcessed: workflows.length };
});

// Escalate overdue approvals
workflowQueue.process(JobType.ESCALATE_APPROVALS, async (job) => {
  const results = await escalateOverdueApprovals();

  return { escalated: results.length };
});
```

**File**: `backend/src/routes/jobs.ts` (~400 lines)

Endpoints:
- `POST /api/jobs/trigger/:jobType` - Manually trigger job
- `GET /api/jobs/status/:jobId` - Get job status
- `GET /api/jobs/active` - List active jobs
- `GET /api/jobs/completed` - List completed jobs
- `GET /api/jobs/failed` - List failed jobs
- `POST /api/jobs/:jobId/retry` - Retry failed job
- `DELETE /api/jobs/:jobId` - Remove job
- `GET /api/jobs/stats` - Get job queue statistics

## Phase 7.5: Integration & Testing

### API Integrations

**Webhook Support**:
```typescript
// Webhook events
export enum WebhookEvent {
  DEAL_CREATED = 'deal.created',
  DEAL_APPROVED = 'deal.approved',
  DEAL_REJECTED = 'deal.rejected',
  DUPLICATE_DETECTED = 'duplicate.detected',
  QUALITY_ALERT = 'quality.alert',
  WORKFLOW_COMPLETED = 'workflow.completed'
}

// Webhook configuration
interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string; // For HMAC signature
  enabled: boolean;
  retryAttempts: number;
  headers?: Record<string, string>;
}
```

**External System Integrations**:
- Salesforce CRM
- Microsoft Dynamics
- Slack/Teams
- Email providers (SendGrid, Mailgun)
- SMS providers (Twilio)

### Testing Requirements

1. **Unit Tests**: Test individual functions in isolation
2. **Integration Tests**: Test workflows end-to-end
3. **Load Tests**: Test with high volume of concurrent workflows
4. **SLA Tests**: Verify SLA tracking and escalation
5. **Notification Tests**: Test all notification channels
6. **Rule Engine Tests**: Test complex rule evaluation

### Sample Test Scenarios

```typescript
describe('Workflow Engine', () => {
  it('should auto-approve high quality deals', async () => {
    const deal = await createTestDeal({
      quality_score: 95,
      has_duplicates: false,
      validation_errors: 0,
      deal_value: 5000
    });

    const workflow = await createWorkflowInstance('deal', deal.id);
    await evaluateRules(workflow.id, WorkflowEvent.QUALITY_SCORED);

    const updatedWorkflow = await getWorkflow(workflow.id);
    expect(updatedWorkflow.current_state).toBe('approved');
  });

  it('should escalate overdue approvals', async () => {
    const approval = await createTestApproval({
      due_at: new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 hours ago
    });

    const results = await escalateOverdueApprovals();

    expect(results.length).toBe(1);
    expect(results[0].approval_request_id).toBe(approval.id);
  });
});
```

## Implementation Timeline

### Week 1-2: Phase 7.1 (Workflow Engine)
- [ ] Create database migration 015_workflows.sql
- [ ] Implement workflowEngine.ts service
- [ ] Create workflow API routes
- [ ] Write unit tests
- [ ] Test workflow state transitions

### Week 3-4: Phase 7.2 (Approval System)
- [ ] Create database migration 016_approvals.sql
- [ ] Implement approvalSystem.ts service
- [ ] Create approval API routes
- [ ] Implement auto-approval logic
- [ ] Test approval chains

### Week 5: Phase 7.3 (Notification System)
- [ ] Create database migration 017_notifications.sql
- [ ] Implement notificationService.ts
- [ ] Set up email integration
- [ ] Set up Slack/Teams integration
- [ ] Create notification API routes

### Week 6: Phase 7.4 (Background Jobs)
- [ ] Set up Bull queues
- [ ] Implement job processors
- [ ] Configure scheduled jobs
- [ ] Create job management API
- [ ] Test job retry and failure handling

### Week 7: Phase 7.5 (Integration & Testing)
- [ ] Write integration tests
- [ ] Load testing
- [ ] SLA testing
- [ ] End-to-end workflow tests
- [ ] Documentation

### Week 8: Phase 7 Completion
- [ ] Bug fixes
- [ ] Performance optimization
- [ ] Final documentation
- [ ] Deployment preparation

## Success Metrics

### Performance Metrics
- **Workflow Processing Time**: < 30 seconds per deal (average)
- **Approval SLA Compliance**: > 95%
- **Auto-Approval Rate**: > 60% of eligible deals
- **Notification Delivery**: > 99.5% success rate

### Business Metrics
- **Manual Effort Reduction**: 70% reduction in manual processing
- **Approval Cycle Time**: 50% reduction
- **Error Rate**: < 1% of workflows
- **User Satisfaction**: > 4.5/5 rating

## Deployment Checklist

### Prerequisites
- [ ] Redis server running
- [ ] Database migrations 015-017 applied
- [ ] Email service configured
- [ ] Slack/Teams webhook URLs configured (optional)
- [ ] Environment variables set

### Configuration
- [ ] Approval chains configured
- [ ] Workflow rules created
- [ ] Notification templates created
- [ ] Auto-approval rules configured
- [ ] SLA thresholds set
- [ ] Job schedules configured

### Testing
- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] Load tests completed
- [ ] SLA escalation tested
- [ ] Notification delivery tested
- [ ] Webhook integrations tested

### Monitoring
- [ ] Application logging configured
- [ ] Error tracking (Sentry/Rollbar)
- [ ] Performance monitoring (New Relic/DataDog)
- [ ] Job queue monitoring
- [ ] SLA breach alerts
- [ ] Notification failure alerts

## Future Enhancements (Phase 8+)

1. **Machine Learning Integration**
   - Predict approval outcomes
   - Auto-categorize deals
   - Anomaly detection

2. **Advanced Analytics**
   - Approval bottleneck analysis
   - Workflow optimization suggestions
   - Predictive SLA management

3. **Mobile Applications**
   - Mobile approval interface
   - Push notifications
   - Offline capability

4. **Advanced Integrations**
   - DocuSign for contract signing
   - Payment gateway integrations
   - Advanced CRM synchronization

5. **Workflow Designer UI**
   - Visual workflow builder
   - Drag-and-drop rule editor
   - Custom approval chain designer

---

**Phase 7 Status**: 📋 PLANNED - Ready for implementation

**Estimated Effort**: 8 weeks (1 senior backend engineer + 1 frontend engineer)

**Dependencies**: Phase 4, 5, 6 must be complete

**Risk Level**: Medium - Complex state management and timing-sensitive operations
