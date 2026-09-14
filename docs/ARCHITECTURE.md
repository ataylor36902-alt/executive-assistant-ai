# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Applications                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Web (React)  │  │   iOS App    │  │ Android App  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API / WebSocket
┌────────────────────────┼────────────────────────────────────┐
│                   API Gateway & Auth                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ JWT Authentication | Rate Limiting | Load Balancer   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
┌───────▼────────┐  ┌────▼────────┐  ┌──▼──────────────┐
│  Microservices │  │ Message Bus │  │ Cache Layer     │
│                │  │             │  │                 │
│ ┌────────────┐ │  │ ┌────────┐  │  │ ┌────────────┐ │
│ │ User Svc   │ │  │ │RabbitMQ│  │  │ │   Redis    │ │
│ ├────────────┤ │  │ │  AWS   │  │  │ ├────────────┤ │
│ │ Calendar   │ │  │ │  SQS   │  │  │ │ Session    │ │
│ │ Meeting    │ │  │ └────────┘  │  │ │ Cache      │ │
│ │ Voice      │ │  │             │  │ │ Real-time  │ │
│ │ Email      │ │  │ ┌────────┐  │  │ │ Data       │ │
│ │ SMS        │ │  │ │Pub/Sub │  │  │ └────────────┘ │
│ │ Analytics  │ │  │ └────────┘  │  └────────────────┘
│ │ Payments   │ │  │             │
│ └────────────┘ │  └─────────────┘
└────────────────┘
        │
        └────────────────┬───────────────────┐
                         │                   │
                ┌────────▼─────────┐  ┌─────▼──────────┐
                │  Data Layer      │  │ External APIs  │
                │                  │  │                │
                │ ┌──────────────┐ │  │ ┌────────────┐ │
                │ │ PostgreSQL   │ │  │ │ Google API │ │
                │ │ (Primary DB) │ │  │ │ Microsoft  │ │
                │ ├──────────────┤ │  │ │ Zoom SDK   │ │
                │ │ MongoDB      │ │  │ │ Twilio     │ │
                │ │ (Documents)  │ │  │ │ OpenAI     │ │
                │ ├──────────────┤ │  │ │ Deepgram   │ │
                │ │ Elasticsearch│ │  │ │ SendGrid   │ │
                │ │ (Logs/Search)│ │  │ └────────────┘ │
                │ └──────────────┘ │  │                │
                └──────────────────┘  └────────────────┘
```

---

## Microservices Architecture

### 1. **User Service** (Authentication & Authorization)
**Responsibility:** User management, authentication, authorization

**Key Features:**
- User registration & onboarding
- Multi-factor authentication (MFA)
- OAuth 2.0 integration with third-party services
- Role-based access control (RBAC)
- Subscription & billing management
- Profile management

**Technology:** Node.js + Express + Passport.js
**Database:** PostgreSQL (users, subscriptions, roles)

**API Endpoints:**
```
POST   /auth/register          - Register new user
POST   /auth/login             - Login with credentials
POST   /auth/oauth/google      - OAuth with Google
POST   /auth/refresh-token     - Refresh JWT token
POST   /auth/logout            - Logout user
GET    /users/:id              - Get user profile
PUT    /users/:id              - Update user profile
GET    /users/:id/subscriptions- Get user subscriptions
```

---

### 2. **Calendar Service**
**Responsibility:** Calendar management and integrations

**Key Features:**
- Google Calendar integration (OAuth)
- Microsoft Outlook integration (OAuth)
- Apple Calendar support
- Event CRUD operations
- Calendar sync & notifications
- Conflict detection
- Smart scheduling suggestions

**Technology:** Node.js + Calendar APIs
**Database:** PostgreSQL + MongoDB (events cache)

**API Endpoints:**
```
GET    /calendars              - List user calendars
GET    /calendars/:id/events   - Get calendar events
POST   /calendars/:id/events   - Create event
PUT    /events/:id             - Update event
DELETE /events/:id             - Delete event
POST   /events/:id/accept      - Accept invitation
GET    /calendars/sync         - Sync with external calendars
POST   /calendars/find-slots   - Find available time slots
```

---

### 3. **Meeting Service**
**Responsibility:** Meeting scheduling and management

**Key Features:**
- Zoom meeting integration
- Google Meet creation
- Microsoft Teams meeting setup
- Automatic link generation
- Meeting reminders
- Calendar integration
- Recurring meeting support

**Technology:** Node.js + Zoom/Google/Microsoft SDKs
**Database:** PostgreSQL

**API Endpoints:**
```
POST   /meetings                - Schedule meeting
GET    /meetings/:id            - Get meeting details
PUT    /meetings/:id            - Update meeting
DELETE /meetings/:id            - Cancel meeting
POST   /meetings/:id/join-link  - Get meeting join link
GET    /meetings/:id/participants - Get attendees
POST   /meetings/:id/reminder   - Send reminder
```

---

### 4. **Voice & Transcription Service**
**Responsibility:** Voice processing and transcription

**Key Features:**
- Real-time transcription (meeting recordings)
- Voicemail transcription
- Dictation service
- Multi-language support
- Speaker identification
- Keyword extraction
- Sentiment analysis

**Technology:** Python + Deepgram/Google Cloud Speech API
**Cache:** Redis for transcription jobs

**API Endpoints:**
```
POST   /transcribe              - Transcribe audio file
POST   /transcribe/start        - Start real-time transcription
GET    /transcribe/:job-id      - Get transcription status
GET    /transcriptions/:id      - Get transcription result
POST   /dictation/start         - Start dictation session
POST   /dictation/stop          - End dictation session
```

---

### 5. **Email Service**
**Responsibility:** Email integration and management

**Key Features:**
- Gmail integration (OAuth)
- Outlook integration (OAuth)
- Email sending & receiving
- Email search & filtering
- Attachment management
- Smart email prioritization
- Draft management

**Technology:** Node.js + Gmail API + Microsoft Graph
**Database:** PostgreSQL + Elasticsearch (email search)

**API Endpoints:**
```
GET    /emails                  - Get email list
GET    /emails/:id              - Get email details
POST   /emails                  - Send email
PUT    /emails/:id              - Update email
DELETE /emails/:id              - Delete email
GET    /emails/search           - Search emails
POST   /emails/:id/reply        - Reply to email
GET    /emails/priority         - Get priority emails
```

---

### 6. **SMS/Messaging Service**
**Responsibility:** SMS and messaging capabilities

**Key Features:**
- SMS sending via Twilio
- SMS receiving & routing
- Voicemail transcription
- Message scheduling
- Template management
- Conversation history

**Technology:** Node.js + Twilio SDK
**Database:** PostgreSQL

**API Endpoints:**
```
POST   /sms/send                - Send SMS
GET    /sms/messages            - Get message history
POST   /sms/schedule            - Schedule SMS
GET    /sms/templates           - Get SMS templates
POST   /sms/templates           - Create template
```

---

### 7. **Meeting Documentation Service**
**Responsibility:** Meeting recording, summarization, and documentation

**Key Features:**
- Automatic meeting recording
- Real-time transcription during meeting
- AI-powered summarization
- Action items extraction
- Key discussion points highlight
- Document generation
- Email distribution of summary

**Technology:** Python (FastAPI) + OpenAI GPT-4
**Database:** PostgreSQL + MongoDB (documents)

**API Endpoints:**
```
POST   /meetings/:id/record     - Start meeting recording
GET    /meetings/:id/recording  - Get recording details
POST   /meetings/:id/summarize  - Generate meeting summary
GET    /meetings/:id/summary    - Get meeting summary
GET    /meetings/:id/action-items - Get action items
POST   /summaries/:id/distribute - Email summary to participants
```

---

### 8. **Task & Priority Service**
**Responsibility:** Task management and AI-powered prioritization

**Key Features:**
- Task CRUD operations
- AI-powered priority ranking
- Task assignment to team members
- Due date tracking
- Progress tracking
- Automated reminders
- Integration with calendar & meetings

**Technology:** Node.js + Python (ML ranking)
**Database:** PostgreSQL + Redis (real-time updates)

**API Endpoints:**
```
GET    /tasks                   - Get all tasks
POST   /tasks                   - Create task
PUT    /tasks/:id               - Update task
DELETE /tasks/:id               - Delete task
GET    /tasks/:id/priority      - Get AI-ranked priority
GET    /tasks/by-priority       - Get tasks sorted by priority
POST   /tasks/:id/assign        - Assign task to user
POST   /tasks/:id/complete      - Mark task complete
```

---

### 9. **Notification Service**
**Responsibility:** Multi-channel notifications

**Key Features:**
- Email notifications
- SMS notifications
- Push notifications (mobile)
- In-app notifications
- Voice call notifications
- Notification scheduling
- Do-not-disturb scheduling
- Notification preferences

**Technology:** Node.js + SendGrid, Twilio, Firebase
**Queue:** RabbitMQ / AWS SQS

**API Endpoints:**
```
POST   /notifications/send      - Send notification
GET    /notifications           - Get notification history
GET    /notifications/preferences - Get user preferences
PUT    /notifications/preferences - Update preferences
POST   /notifications/schedule  - Schedule notification
```

---

### 10. **Analytics Service**
**Responsibility:** Usage analytics and business intelligence

**Key Features:**
- User activity tracking
- Feature usage analytics
- Performance metrics
- Revenue analytics
- User engagement tracking
- Churn prediction
- Business reports

**Technology:** Python + Mixpanel / Amplitude / custom solution
**Database:** PostgreSQL + Data Warehouse (Redshift/BigQuery)

**API Endpoints:**
```
GET    /analytics/dashboard     - Get analytics dashboard
GET    /analytics/usage         - Get feature usage
GET    /analytics/engagement    - Get engagement metrics
GET    /analytics/revenue       - Get revenue metrics
GET    /analytics/cohort/:id    - Get cohort analysis
```

---

### 11. **Billing & Payment Service**
**Responsibility:** Subscription management and payments

**Key Features:**
- Stripe integration
- Subscription management
- Invoice generation
- Payment processing
- Refunds & disputes
- Tax calculation
- Usage-based billing

**Technology:** Node.js + Stripe API
**Database:** PostgreSQL

**API Endpoints:**
```
POST   /billing/subscribe       - Create subscription
GET    /billing/subscription    - Get subscription details
PUT    /billing/subscription    - Update subscription
DELETE /billing/subscription    - Cancel subscription
GET    /billing/invoices        - Get invoice history
POST   /billing/pay             - Process payment
```

---

### 12. **Integration Service**
**Responsibility:** Third-party integrations management

**Key Features:**
- CRM integrations (Salesforce, HubSpot)
- Project management integrations (Asana, Monday.com)
- Webhook management
- API key management
- Integration marketplace
- Custom integration builder

**Technology:** Node.js
**Database:** PostgreSQL

---

## Data Flow Patterns

### Meeting Recording & Summarization Flow

```
1. User schedules meeting in Calendar Service
2. Meeting starts in Zoom/Google Meet
3. Meeting Service detects meeting and initiates recording
4. Voice & Transcription Service streams audio real-time
5. Transcription is stored in PostgreSQL
6. When meeting ends, trigger Meeting Documentation Service
7. OpenAI API generates summary, action items, key points
8. Summary stored in MongoDB
9. Notification Service sends email with summary to participants
10. Analytics Service logs the event
11. Email Service archives summary
```

### Email Processing Flow

```
1. User forwards/links email in UI
2. Email Service retrieves email via Gmail/Outlook API
3. Analyze content for priority (ML model)
4. Extract action items (NLP)
5. Link to relevant calendar events (if applicable)
6. Add to priority list in Task Service
7. Create notification if urgent
8. Cache in Redis for fast retrieval
9. Index in Elasticsearch for search
```

### Task Priority Ranking Flow

```
1. User creates task
2. Extract task features (deadline, keywords, category)
3. ML model ranks priority (0-100)
4. Consider related meetings/emails for context
5. Sort tasks by priority
6. Send notification for high-priority tasks
7. Update UI with ranked list
8. Learning: track if user agrees with ranking
```

---

## Technology Stack Details

### Backend Stack
```
Runtime:       Node.js v18+ (Express.js) OR Python 3.10+ (FastAPI)
API:           REST + GraphQL (optional)
Real-time:     WebSocket via Socket.io
Auth:          JWT + OAuth 2.0
DB:            PostgreSQL 14+, MongoDB 5+, Redis 7+
Message Queue: RabbitMQ or AWS SQS
Task Queue:    Bull (Node) or Celery (Python)
Search:        Elasticsearch 8+
Caching:       Redis
Monitoring:    ELK Stack / Datadog / New Relic
```

### Frontend Stack
```
Framework:     React 18+ with Next.js
State:         Redux or Zustand
Real-time:     Socket.io client
HTTP:          Axios or Fetch API
UI Components: Material-UI v5 or Tailwind CSS
Mobile:        React Native or Flutter
```

### AI/ML Stack
```
NLP:           OpenAI GPT-4 API
Speech-to-Text: Deepgram or Google Cloud Speech
Summarization: OpenAI + custom models
Ranking:       Scikit-learn or TensorFlow
Embeddings:    OpenAI Embeddings or Hugging Face
```

### Infrastructure
```
Cloud:         AWS (or GCP/Azure)
Compute:       ECS/EKS (containers)
Storage:       S3 for files, RDS for databases
CDN:           CloudFront
Deployment:    Docker + Kubernetes
CI/CD:         GitHub Actions / Jenkins
```

---

## Security Architecture

### Authentication & Authorization
- JWT tokens with expiration
- Refresh token rotation
- OAuth 2.0 for third-party integrations
- Role-based access control (RBAC)
- Multi-factor authentication (MFA)

### Data Security
- Encryption in transit (TLS 1.3)
- Encryption at rest (AES-256)
- PII masking in logs
- Regular security audits
- Penetration testing

### API Security
- Rate limiting (Redis)
- CORS protection
- CSRF tokens
- SQL injection prevention
- XSS protection
- API key management

### Compliance
- GDPR compliance
- CCPA compliance
- SOC 2 Type II
- HIPAA ready
- Data retention policies

---

## Scalability Considerations

### Horizontal Scaling
- Stateless microservices
- Load balancing with ALB
- Auto-scaling groups
- Database read replicas
- Redis cluster

### Performance Optimization
- Query optimization & indexing
- Caching strategies (Redis)
- CDN for static assets
- Async processing (message queue)
- Database connection pooling

### Monitoring & Observability
- Application Performance Monitoring (APM)
- Centralized logging
- Distributed tracing
- Real-time alerting
- Custom dashboards

---

## Disaster Recovery & HA

### Backup Strategy
- Daily automated backups
- Point-in-time recovery
- Multi-region replication
- Backup verification

### High Availability
- Multi-zone deployment
- Database failover
- Load balancer failover
- Circuit breakers
- Health checks

### RTO/RPO Targets
- RTO (Recovery Time Objective): 1 hour
- RPO (Recovery Point Objective): 15 minutes
- 99.95% uptime SLA

---

## Cost Optimization

### Infrastructure Costs (Estimated Year 1)
- Compute: $30K
- Database: $20K
- Storage: $5K
- CDN: $3K
- Third-party APIs: $60K
- **Total:** ~$120K

### Cost Reduction Strategies
- Reserved instances for compute
- Spot instances for batch jobs
- Smart caching
- Data archival policies
- API rate negotiation

