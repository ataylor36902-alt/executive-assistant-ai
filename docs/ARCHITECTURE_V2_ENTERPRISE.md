# Executive Assistant AI - Enhanced Architecture v2.0

## Critical Updates Based on Enterprise Requirements

This document outlines the revised architecture that addresses the gaps between a demo and a production-ready, monetizable platform.

---

## Core Insight: The Unified Contact Record

**The Single Most Important Change:** Everything pivots around a **Contact/Company/Deal Record** as the unifying data model.

Every action (email, call, meeting, task, note, file, opportunity) is now **linked to and indexed by contact records**. This enables:
- Relationship history view
- Interaction timeline
- Automated follow-up triggers
- Opportunity tracking
- Relationship health scoring
- Revenue attribution

### Data Model: Contact-Centric Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTACT RECORD (Core)                     │
│  - ID, Name, Company, Email, Phone, Title, Social Profiles │
│  - Last Interaction Date, Interaction Count                 │
│  - Relationship Health Score, Revenue Attributed            │
└─────────────────┬───────────────────────────────────────────┘
                  │
        ┌─────────┼─────────────────────────────┐
        │         │         │        │          │
        ▼         ▼         ▼        ▼          ▼
    ┌────────┐ ┌────────┐ ┌─────┐ ┌──────┐ ┌────────┐
    │ Emails │ │ Calls  │ │Tasks│ │Files │ │Meetings│
    └────────┘ └────────┘ └─────┘ └──────┘ └────────┘
        │         │         │        │          │
        └─────────┴─────────┴────────┴──────────┘
                  │
        ┌─────────▼──────────────┐
        │ TIMELINE & HISTORY     │
        │ (All interactions)     │
        └────────────────────────┘
```

---

## Phase 1: MVP (Months 1-3) - Foundation with CRM Core

### Must-Have Features

#### 1. **Contact Management (CRM Foundation)**
- Contact database with rich profiles
- Company records with hierarchy
- Contact import/export (CSV, LinkedIn, Gmail contacts)
- Duplicate detection & merging
- Contact segmentation & tagging
- Relationship health scoring (based on interaction recency)
- RACI assignment (who's responsible, accountable, consulted, informed)

**Data Fields:**
```
Contact {
  id, firstName, lastName, email, phone, title, department,
  company, linkedinUrl, twitterHandle, avatar,
  lastInteractionDate, totalInteractions, relationshipScore,
  status (active/inactive/archived), notes, tags,
  createdAt, updatedAt
}

Company {
  id, name, industry, website, size, revenue, headquarters,
  linkedinUrl, crunchbaseUrl, parentCompanyId, contacts[]
}

Deal {
  id, title, value, stage, probability, closeDate, contactId,
  companyId, owner, notes, attachments
}
```

#### 2. **Real Gmail Integration** (Not Mock)
- OAuth 2.0 read/write access to Gmail
- Email sync to contact record (bidirectional)
- Email search across all conversations
- Smart labeling system (auto-categorize by contact/company)
- Unread badge and priority inbox
- Draft management with AI suggestions
- Email templates library with variables

**Integration Points:**
- Use Gmail API for real-time sync
- Cache in PostgreSQL for fast search
- Index in Elasticsearch for full-text search
- Redis for sync status tracking

#### 3. **Real Google Calendar Integration**
- OAuth 2.0 read/write to Google Calendar
- Two-way sync (changes in app sync to Calendar, and vice versa)
- Meeting detection from calendar events
- Auto-link meetings to contacts based on attendee email
- Calendar availability checking for scheduling
- Timezone handling across meetings

**Key Queries:**
```sql
-- Find all interactions for a contact
SELECT * FROM interactions 
WHERE contact_id = ? 
ORDER BY interaction_date DESC;

-- Get upcoming meetings with contact
SELECT meetings.* FROM meetings
JOIN meeting_attendees ON meetings.id = meeting_attendees.meeting_id
WHERE contact_id = ? AND meeting_date > NOW()
ORDER BY meeting_date ASC;

-- Calculate relationship health score
SELECT DATEDIFF(NOW(), MAX(interaction_date)) as days_since_contact
FROM interactions WHERE contact_id = ?;
```

#### 4. **Call Logging & Voicemail Transcription**
- Log calls against contacts (time, duration, notes, outcome)
- Voicemail-to-text transcription (Deepgram/Twilio)
- Call recording storage (AWS S3)
- Call notes auto-linking to email/meeting follow-ups
- Integration with phone system (initially Twilio, later RingCentral, 8x8)

**Call Record Schema:**
```
Call {
  id, contactId, direction (inbound/outbound), 
  phoneNumber, duration, recordingUrl, 
  transcript (from voicemail), 
  notes, sentiment (positive/negative/neutral),
  recordedAt, createdAt
}
```

#### 5. **Task Management with Contact Linking**
- Tasks linked to contacts/companies/deals
- Smart priority ranking (AI + manual override)
- Due date and reminder system
- Task templates for common workflows
- Recurring tasks
- Collaboration and assignment

#### 6. **Meeting Prep & Briefing Documents**
- Auto-generate meeting briefing (contact history, last interactions, pending items)
- Pre-meeting email exchange summary
- LinkedIn profile snapshot
- Recent news about contact's company
- Outstanding action items from previous meetings

#### 7. **Basic Transcription & Meeting Notes**
- Zoom meeting detection + recording
- Real-time transcription (Deepgram/Whisper)
- AI-generated meeting summary
- Action items extraction (with owner assignment)
- Email summary to attendees with key points

---

## Phase 2: Expansion (Months 4-6) - Communication & Automation

### Communication Layer

#### 1. **SMS/Text Messaging (Twilio)**
- Send and receive SMS from contacts
- Link SMS conversations to contact record
- SMS templates for common messages
- Automated SMS reminders

#### 2. **WhatsApp Integration** (Twilio)
- WhatsApp Business API integration
- Message threading per contact
- Media sharing

#### 3. **Slack Integration**
- Link Slack messages to contacts (when Slack message mentions a contact)
- Create Slack reminders for tasks/follow-ups
- Slack bot for contact lookups
- Post meeting summaries to Slack

#### 4. **Microsoft 365 / Outlook Integration**
- Outlook mail and calendar sync (parallel to Gmail)
- Teams meeting integration
- Exchange contact sync

#### 5. **LinkedIn Integration**
- Contact profile scraping (name, title, company, background)
- Company research feeds
- Connection suggestions based on email
- Pre-meeting LinkedIn profile display

#### 6. **Broadcast Messaging & Groups**
- Create distribution lists within the app
- Send templated emails/SMS to groups
- Track response rates per recipient
- Automated follow-up sequences

**Example Workflow:**
```
1. Create group: "Q4 Prospects"
2. Select email template: "30-day check-in"
3. Personalize variables: {firstName}, {companyName}, {lastInteractionDate}
4. Send to group
5. App tracks: opens, clicks, replies
6. Auto-send follow-up after 7 days if no reply
```

#### 7. **Automated Follow-Up Logic**
```python
# Pseudo-code for follow-up engine
def check_follow_up_triggers():
    # Find emails with no response
    for email in emails.filter(sent_date__lte=7_days_ago, has_reply=False):
        # Check if marked as "waiting for response"
        if email.tags.contains('waiting_for_response'):
            # Create task: "Follow up with {contact.firstName}"
            create_task(
                contact=email.contact,
                title=f"Follow up: {email.subject}",
                priority='high',
                due_date=today + 1_day
            )
            # Send gentle reminder to contact
            if email.contact.preferred_channel == 'email':
                send_email(
                    to=email.contact.email,
                    subject=f"Re: {email.subject}",
                    body="Just checking in..."
                )
```

---

## Phase 3: Intelligence & Analytics (Months 7-9)

### AI & Automation Layer

#### 1. **Smart Email Triage**
- Auto-categorize incoming emails (action required, FYI, urgent, etc.)
- Link emails to contacts/deals automatically
- Suggested responses (powered by GPT-4)
- Flag emails mentioning specific keywords ("budget", "budget approved", "decision", etc.)

#### 2. **AI-Powered Email Drafting**
- Suggest email responses based on context
- Auto-complete based on contact communication history
- Tone adjustment (formal, casual, urgent)
- Grammar and spell check

#### 3. **Web Research & Intelligence**
- Research a contact/company before calls (web scraping + APIs)
- Recent news feed for contacts' industries
- Competitive intelligence (Crunchbase, PitchBook for startups)
- Stock price alerts for public company contacts

**Research Data Model:**
```
ContactIntelligence {
  contactId, dataType (news, financial, social),
  source, headline, summary, url, relevance_score,
  createdAt
}
```

#### 4. **Relationship Health Scoring**
Calculate automatic score based on:
- Days since last interaction (weight: 40%)
- Interaction frequency (weight: 30%)
- Response rate on emails (weight: 20%)
- Relationship status (active/warm/cold) (weight: 10%)

**Score Calculation:**
```
health_score = (
  (30 / days_since_interaction) * 40 +
  (recent_interaction_count / 10) * 30 +
  (response_rate) * 20 +
  (status_weight) * 10
) / 100
```

#### 5. **Predictive Analytics**
- Churn prediction: "This contact is getting cold, risk of disengagement"
- Next best action: "Schedule coffee with Sarah based on conversation pattern"
- Optimal communication time: "Sarah typically replies to emails sent after 9 AM on Tuesdays"
- Deal forecasting: Probability of deal closure based on interaction patterns

---

## Phase 4: Enterprise Features (Months 10-12)

### Financial & Billing Integration

#### 1. **QuickBooks Integration**
- Sync invoices and payments
- Log expenses against contacts/deals
- Budget vs. actual tracking
- Revenue attribution to contacts

#### 2. **Stripe/Paddle Integration**
- Track subscription status of each contact (if SaaS business)
- Revenue per customer dashboard
- Payment history

#### 3. **Time Tracking & Billing**
- Log billable hours against contacts/projects
- Invoice generation with time entries
- Client billing statements
- Timesheet templates for recurring engagements

### Document Management

#### 1. **DocuSign Integration**
- E-signature management
- Contract tracking
- Signature reminders

#### 2. **Document Storage**
- Attach files to contact records
- Version history
- Template library for proposals, contracts, NDAs
- Search across documents

#### 3. **Template Library**
- Proposal templates
- Email templates
- Meeting agenda templates
- Contract templates

### Travel & Logistics

#### 1. **Travel Booking Integration**
- Amex GBT or Sabre integration for flights/hotels
- Itinerary extraction from emails
- Travel time calculations to meetings
- Ground transportation booking

#### 2. **Timezone Intelligence**
- Auto-detect contact timezone
- Suggest meeting times that work across timezones
- Display contact timezone in UI

### Advanced Integrations

#### 1. **Salesforce CRM Sync**
- Two-way sync of contacts, deals, accounts
- Activity logging from Executive Assistant app back to Salesforce
- Pipeline visibility

#### 2. **HubSpot Integration**
- Contact and deal sync
- Activity logging
- Email integration

#### 3. **Notion Integration**
- Link Notion pages to contacts
- Store meeting notes in Notion
- Query Notion databases within the app

#### 4. **Zapier Integration**
- Trigger workflows based on app events
- Connect to 5000+ apps via Zapier
- Example: "When email received from VIP contact, post to Slack"

#### 5. **VoIP System Integration**
- RingCentral
- 8x8
- Vonage
- Auto-log calls with contact lookup

---

## Updated Data Model (Complete)

```javascript
// Core Entities

Contact {
  id: UUID,
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  title: String,
  department: String,
  company: Company reference,
  linkedinUrl: String,
  twitterHandle: String,
  avatar: String,
  
  // Relationship fields
  relationshipStatus: enum (active, warm, cold, archived),
  relationshipScore: Float (0-100),
  relationshipHistory: {
    firstContactDate: Date,
    lastInteractionDate: Date,
    totalInteractions: Int,
    avgResponseTime: Duration,
    responseRate: Float (0-1)
  },
  
  // Custom fields
  tags: Array<String>,
  notes: String,
  customFields: JSON,
  
  // Metadata
  owner: User reference,
  createdAt: Date,
  updatedAt: Date
}

Company {
  id: UUID,
  name: String,
  industry: String,
  website: String,
  size: enum (1-10, 11-50, 51-200, 201-500, 501-1000, 1000+),
  revenue: String,
  headquarters: String,
  linkedinUrl: String,
  crunchbaseUrl: String,
  parentCompanyId: UUID,
  contacts: Array<Contact>,
  createdAt: Date,
  updatedAt: Date
}

Deal {
  id: UUID,
  title: String,
  value: Decimal,
  stage: enum (prospect, qualification, proposal, negotiation, won, lost),
  probability: Float (0-1),
  closeDate: Date,
  contact: Contact reference,
  company: Company reference,
  owner: User reference,
  notes: String,
  attachments: Array<File>,
  createdAt: Date,
  updatedAt: Date
}

Interaction {
  id: UUID,
  contact: Contact reference,
  type: enum (email, call, meeting, note, sms, task_completed),
  title: String,
  description: String,
  outcome: String,
  direction: enum (inbound, outbound), // for calls
  duration: Int, // seconds
  participants: Array<User>,
  linkedRecords: Array<{recordType, recordId}>, // link to email, call, meeting
  sentiment: enum (positive, negative, neutral),
  createdAt: Date,
  updatedAt: Date
}

Email {
  id: UUID,
  contact: Contact reference,
  messageId: String, // Gmail message ID
  from: String,
  to: Array<String>,
  cc: Array<String>,
  bcc: Array<String>,
  subject: String,
  body: String,
  bodyHtml: String,
  attachments: Array<File>,
  labels: Array<String>, // Gmail labels + custom
  isRead: Boolean,
  isStarred: Boolean,
  hasReply: Boolean,
  replyTime: Int, // seconds until reply
  sentiment: enum (positive, negative, neutral),
  importance: enum (high, normal, low),
  gmailSyncedAt: Date,
  createdAt: Date,
  receivedAt: Date
}

Call {
  id: UUID,
  contact: Contact reference,
  direction: enum (inbound, outbound),
  phoneNumber: String,
  duration: Int, // seconds
  recordingUrl: String,
  transcript: String,
  transcriptHighlights: Array<String>,
  notes: String,
  sentiment: enum (positive, negative, neutral),
  outcome: enum (answered, voicemail, missed, declined),
  recordedAt: Date,
  createdAt: Date
}

Meeting {
  id: UUID,
  title: String,
  description: String,
  contacts: Array<Contact>,
  attendees: Array<{email, name}>,
  startTime: Date,
  endTime: Date,
  timezone: String,
  location: String,
  videoConferenceUrl: String,
  calendarEventId: String, // Google Calendar event ID
  
  // Recording & transcription
  recordingUrl: String,
  transcription: String,
  summary: String,
  keyPoints: Array<String>,
  actionItems: Array<{owner, description, dueDate}>,
  
  // Prep
  briefingDocUrl: String,
  agendaUrl: String,
  
  createdAt: Date,
  updatedAt: Date
}

Task {
  id: UUID,
  title: String,
  description: String,
  contact: Contact reference,
  deal: Deal reference,
  owner: User reference,
  assignee: User reference,
  priority: Int (0-100), // AI-ranked
  dueDate: Date,
  reminderTime: Date,
  status: enum (open, in_progress, completed, cancelled),
  linkedRecords: Array<{type, id}>,
  createdAt: Date,
  completedAt: Date
}

Note {
  id: UUID,
  contact: Contact reference,
  title: String,
  content: String,
  attachments: Array<File>,
  mentions: Array<User>, // @mentions
  createdAt: Date,
  updatedAt: Date
}
```

---

## API Priority Order (First 90 Days)

### Week 1-2: Core CRUD
```
POST   /contacts                 - Create contact
GET    /contacts                 - List contacts (search, filter, paginate)
GET    /contacts/:id             - Get single contact
PUT    /contacts/:id             - Update contact
DELETE /contacts/:id             - Delete contact

POST   /companies                - Create company
GET    /companies                - List companies
GET    /companies/:id            - Get company details
PUT    /companies/:id            - Update company
```

### Week 3-4: Real Gmail Sync
```
POST   /auth/gmail               - Connect Gmail (OAuth)
GET    /auth/gmail/status        - Check Gmail sync status
POST   /emails/sync              - Trigger manual sync
GET    /emails                   - Get emails
GET    /emails/search            - Search emails (full-text)
POST   /emails                   - Send email
POST   /emails/:id/reply         - Reply to email
GET    /contacts/:id/emails      - Get all emails for a contact
```

### Week 5-6: Real Google Calendar Sync
```
POST   /auth/calendar            - Connect Google Calendar (OAuth)
GET    /calendar/events          - Get calendar events
POST   /calendar/events          - Create calendar event
GET    /contacts/:id/meetings    - Get meetings with contact
POST   /meetings                 - Create meeting
GET    /meetings                 - List meetings
```

### Week 7-8: Calls & Voicemail
```
POST   /calls                    - Log call
GET    /calls                    - List calls
GET    /contacts/:id/calls       - Get calls with contact
POST   /voicemail/transcribe     - Transcribe voicemail
```

### Week 9-10: Tasks & Reminders
```
POST   /tasks                    - Create task
GET    /tasks                    - List tasks (with AI priority)
GET    /tasks/priority-list      - Get AI-ranked priority list
POST   /tasks/:id/complete       - Complete task
POST   /reminders                - Create reminder
```

### Week 11-12: Timeline & Interactions
```
GET    /contacts/:id/timeline    - Get interaction timeline (all emails, calls, meetings, tasks)
GET    /contacts/:id/relationship-score - Get relationship health
GET    /contacts/:id/summary     - Get contact summary/briefing
```

---

## Technology Stack (Revised for Real Integrations)

### Backend
```
Language:       Node.js v18+ with Express.js
Task Queue:     Bull + Redis (for sync jobs, AI processing)
Message Bus:    RabbitMQ (for event-driven arch)
Database:       PostgreSQL 14+ (ACID compliance for financial data)
Cache:          Redis (sessions, sync status, rate limiting)
Search:         Elasticsearch 8+ (full-text email search)
Storage:        AWS S3 (files, recordings, documents)
```

### Integrations Layer
```
Gmail API:      google-auth-library-nodejs, googleapis
Google Calendar: googleapis
Zoom SDK:       zoom-us-api-nodejs
Twilio:         twilio (SMS, calls, voicemail)
Deepgram:       @deepgram/sdk (transcription)
OpenAI:         openai (summarization, email drafting)
Stripe:         stripe (billing)
DocuSign:       docusign-esign (e-signatures)

Queue for integrations:
- Gmail sync job: runs every 5 minutes
- Calendar sync job: runs every 5 minutes
- Voicemail transcription: async with queue
- Email summarization: async with queue
- AI briefing generation: on-demand
```

### Frontend (Revised for Real Use)
```
Framework:      React 18 + Next.js 13+
State:          Redux (for complex data from integrations)
Real-time:      Socket.io + React hooks
Email viewer:   react-email-viewer
Calendar:       react-big-calendar
Rich text:      TipTap or Slate
Charts:         Recharts or Victory
Form validation: React Hook Form + Zod
```

---

## Revenue Model (Updated Based on Deeper Features)

### Tier 1: Starter ($19/month)
- 100 contacts
- Email & Calendar (Gmail only)
- Call logging
- Basic tasks
- 3 smart features/month (AI summary, briefing, research)

### Tier 2: Professional ($79/month)
- 2,000 contacts
- Email & Calendar (Gmail + Outlook)
- SMS via Twilio
- Unlimited smart features
- Call recording & transcription
- Meeting summaries
- Relationship scoring
- API access (10,000 calls/month)

### Tier 3: Business ($199/month)
- 10,000 contacts
- All communication channels (Email, SMS, WhatsApp, Slack)
- Salesforce + HubSpot sync
- Document management (DocuSign)
- Time tracking & billing
- Advanced analytics
- Team management (up to 5 seats)
- API access (100,000 calls/month)

### Tier 4: Enterprise (Custom, $500-2000+/month)
- Unlimited contacts
- All integrations (Salesforce, HubSpot, QuickBooks, etc.)
- White-label option
- Custom workflows via Zapier
- Dedicated Slack support channel
- SLA guarantee (99.95% uptime)
- Advanced security (SSO, audit logs, encryption)
- Custom AI models trained on company data

---

## Success Metrics (First Year)

| Metric | Month 3 | Month 6 | Month 12 |
|--------|---------|---------|----------|
| Gmail integrations | 100 | 800 | 4,000 |
| Contacts synced | 50K | 200K | 800K |
| Calendar events synced | 30K | 150K | 600K |
| Emails processed | 200K | 1.2M | 5M |
| Calls logged | 2K | 15K | 60K |
| Paid users | 50 | 400 | 2,000 |
| MRR | $4K | $32K | $160K |

---

## Critical Path to Product-Market Fit

### Do First (Weeks 1-4)
1. Real Gmail integration (OAuth + email sync)
2. Contact management with import
3. Email linked to contacts
4. Simple contact view with email history

### Do Second (Weeks 5-8)
1. Real Google Calendar integration
2. Meeting detection and linking to contacts
3. Meeting prep briefing document
4. Call logging

### Do Third (Weeks 9-12)
1. Transcription + meeting summaries
2. Task management with contact linking
3. Relationship health scoring
4. Timeline view (all interactions for a contact)

**Why This Order:**
- Gmail integration validates the core insight: "I can see all my email history with Sarah in one place"
- Calendar integration proves meetings can be linked to contacts
- Transcription + summary proves AI value
- Timeline + scoring proves relationship tracking

This creates an "aha moment" where the product becomes indispensable because it's the single source of truth for customer relationships.

