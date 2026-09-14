# Complete Adalo Integration Guide

## Overview

This guide walks you through connecting your Node.js backend to Adalo, a no-code platform for building apps.

**Timeline:** 2-3 hours to complete
**Cost:** Free (Adalo free tier)
**Result:** Fully functional MVP with login, contacts, emails, and tasks

---

## Part 1: Deploy Backend to Heroku (10 minutes)

### 1.1 Install Heroku CLI

```bash
# macOS
brew tap heroku/brew && brew install heroku

# Verify
heroku --version
```

### 1.2 Login to Heroku

```bash
heroku login
# Opens browser to authenticate
```

### 1.3 Create Heroku App

```bash
# From project root
heroku create executive-assistant-api
```

Save the URL it gives you (e.g., `https://executive-assistant-api.herokuapp.com`)

### 1.4 Add Database & Redis

```bash
# PostgreSQL
heroku addons:create heroku-postgresql:standard-0

# Redis
heroku addons:create heroku-redis:premium-0
```

### 1.5 Set Environment Variables

```bash
# Generate random secrets
heroku config:set JWT_SECRET=$(openssl rand -base64 32)
heroku config:set REFRESH_TOKEN_SECRET=$(openssl rand -base64 32)

# API URLs (replace with your actual URLs)
heroku config:set API_URL="https://YOUR_APP_NAME.herokuapp.com"
heroku config:set FRONTEND_URL="https://your-adalo-app.adalo.com"

# Logging
heroku config:set LOG_LEVEL="info"

# Google OAuth (get from Google Cloud Console)
heroku config:set GOOGLE_CLIENT_ID="xxx"
heroku config:set GOOGLE_CLIENT_SECRET="xxx"
heroku config:set GOOGLE_CALLBACK_URL="https://YOUR_APP_NAME.herokuapp.com/auth/google/callback"

# Claude AI (get from Anthropic)
heroku config:set ANTHROPIC_API_KEY="xxx"

# Deepgram (get from Deepgram)
heroku config:set DEEPGRAM_API_KEY="xxx"

# OpenAI (get from OpenAI)
heroku config:set OPENAI_API_KEY="xxx"
```

### 1.6 Deploy

```bash
# Deploy code
git push heroku main

# Watch logs
heroku logs --tail
```

### 1.7 Test

```bash
# Should return {"status":"OK","timestamp":"..."}
curl https://YOUR_APP_NAME.herokuapp.com/health
```

✅ **Backend is live!**

Your API URL: `https://YOUR_APP_NAME.herokuapp.com/api`

---

## Part 2: Create Adalo App (5 minutes)

### 2.1 Sign Up for Adalo

1. Go to **https://adalo.com**
2. Click **Sign Up**
3. Create account
4. Create a new **Blank App**

### 2.2 Add Custom API Integration

1. In Adalo, go to **Integrations** (left sidebar)
2. Click **+ Create New API**
3. Fill in:
   ```
   Name: Executive Assistant API
   Base URL: https://YOUR_APP_NAME.herokuapp.com/api
   ```
4. Click **Save**

### 2.3 Create Collections (Database)

Adalo has built-in database. Create these collections:

**Users Collection:**
- Email (text)
- Password (text)
- FirstName (text)
- LastName (text)
- AuthToken (text)
- GmailConnected (boolean)
- CreatedAt (date)

**Contacts Collection:**
- FirstName (text)
- LastName (text)
- Email (text)
- Phone (text)
- Company (text)
- RelationshipScore (number)
- LastInteractionDate (date)
- Notes (text)
- UserId (reference to Users)

**Emails Collection:**
- From (text)
- To (text)
- Subject (text)
- Body (text)
- ReceivedAt (date)
- IsRead (boolean)
- Priority (text: high/medium/low)
- ContactId (reference to Contacts)
- UserId (reference to Users)

**Meetings Collection:**
- Title (text)
- Description (text)
- StartTime (date)
- EndTime (date)
- Attendees (text)
- VideoConferenceUrl (text)
- Transcript (text)
- Summary (text)
- ContactId (reference to Contacts)
- UserId (reference to Users)

**Tasks Collection:**
- Title (text)
- Description (text)
- Priority (number: 0-100)
- DueDate (date)
- Status (text: open/in_progress/completed)
- ContactId (reference to Contacts)
- UserId (reference to Users)

---

## Part 3: Build API Endpoints in Adalo (30 minutes)

### 3.1 Create API Action: User Registration

1. Go to **Integrations** → **Executive Assistant API**
2. Click **+ New API Call**
3. Name: `RegisterUser`
4. Fill in:
   ```
   Method: POST
   Endpoint: /auth/register
   Body:
   {
     "email": "{{email}}",
     "password": "{{password}}",
     "firstName": "{{firstName}}",
     "lastName": "{{lastName}}"
   }
   ```
5. Click **Save**

### 3.2 Create API Action: User Login

1. Create new API call
2. Name: `LoginUser`
3. Fill in:
   ```
   Method: POST
   Endpoint: /auth/login
   Body:
   {
     "email": "{{email}}",
     "password": "{{password}}"
   }
   Headers:
   (none for login)
   ```
4. **Save response to variable:** `authToken`
5. Click **Save**

### 3.3 Create API Action: Get Contacts

1. Create new API call
2. Name: `GetContacts`
3. Fill in:
   ```
   Method: GET
   Endpoint: /contacts
   Headers:
   {
     "Authorization": "Bearer {{authToken}}"
   }
   ```
4. **Save response to variable:** `contactsList`
5. Click **Save**

### 3.4 Create API Action: Get Emails for Contact

1. Create new API call
2. Name: `GetContactEmails`
3. Fill in:
   ```
   Method: GET
   Endpoint: /contacts/{{selectedContactId}}/emails
   Headers:
   {
     "Authorization": "Bearer {{authToken}}"
   }
   ```
4. **Save response to variable:** `emailsList`
5. Click **Save**

### 3.5 Create API Action: Get Tasks

1. Create new API call
2. Name: `GetTasks`
3. Fill in:
   ```
   Method: GET
   Endpoint: /tasks
   Headers:
   {
     "Authorization": "Bearer {{authToken}}"
   }
   ```
4. **Save response to variable:** `tasksList`
5. Click **Save**

### 3.6 Create API Action: Get Meetings

1. Create new API call
2. Name: `GetMeetings`
3. Fill in:
   ```
   Method: GET
   Endpoint: /meetings
   Headers:
   {
     "Authorization": "Bearer {{authToken}}"
   }
   ```
4. **Save response to variable:** `meetingsList`
5. Click **Save**

### 3.7 Create API Action: Get Meeting Summary

1. Create new API call
2. Name: `GetMeetingSummary`
3. Fill in:
   ```
   Method: GET
   Endpoint: /meetings/{{selectedMeetingId}}/summary
   Headers:
   {
     "Authorization": "Bearer {{authToken}}"
   }
   ```
4. **Save response to variable:** `meetingSummary`
5. Click **Save**

### 3.8 Create API Action: Get Relationship Score

1. Create new API call
2. Name: `GetRelationshipScore`
3. Fill in:
   ```
   Method: GET
   Endpoint: /contacts/{{selectedContactId}}/relationship-score
   Headers:
   {
     "Authorization": "Bearer {{authToken}}"
   }
   ```
4. **Save response to variable:** `relationshipScore`
5. Click **Save**

---

## Part 4: Build UI Screens (1.5 hours)

### 4.1 Create Login Screen

**Step 1: Add components**
1. Go to **Screens**
2. Create new screen: `LoginScreen`
3. Add components:
   - **Text:** "Executive Assistant AI"
   - **Input:** Email (placeholder: "Enter email")
   - **Input:** Password (placeholder: "Enter password")
   - **Button:** "Login"
   - **Link:** "Don't have an account? Sign up"

**Step 2: Add login action**
1. Click **Login button** → **Add Action**
2. Select **Execute API Call** → **LoginUser**
3. Map inputs:
   - email → Email Input
   - password → Password Input
4. On success: **Save Text** → Save email to user storage
5. On success: **Save Text** → Save authToken to user storage
6. On success: **Navigate to** → HomeScreen
7. On error: **Show notification** → "Login failed"

### 4.2 Create Registration Screen

1. Create new screen: `SignUpScreen`
2. Add components:
   - **Text:** "Create Account"
   - **Input:** First Name
   - **Input:** Last Name
   - **Input:** Email
   - **Input:** Password
   - **Button:** "Sign Up"
   - **Link:** "Already have an account? Login"

3. Add signup action:
   - Click **Sign Up button** → **Add Action**
   - Select **Execute API Call** → **RegisterUser**
   - Map all inputs
   - On success: Navigate to LoginScreen
   - On error: Show error notification

### 4.3 Create Home Screen (Dashboard)

1. Create new screen: `HomeScreen`
2. Add components:
   - **Text:** "Welcome, {{firstName}}!"
   - **Tab Bar** with 4 tabs:
     - Contacts
     - Emails
     - Tasks
     - Meetings

3. On screen load: **Execute API Call** → **GetContacts**
4. On screen load: **Execute API Call** → **GetTasks**
5. On screen load: **Execute API Call** → **GetMeetings**

### 4.4 Create Contacts Screen

1. Inside HomeScreen tab: `ContactsTab`
2. Add components:
   - **Search bar** (filters contacts)
   - **List** (shows contactsList)
     - **Item components:**
       - Name (text)
       - Email (text)
       - Relationship Score (number, colored: red if < 30, yellow if < 60, green if >= 60)
       - Last Interaction Date (text)
   - **Button:** "+ New Contact"

3. Add click action:
   - On contact click: **Set variable** → selectedContact = clicked contact
   - On contact click: **Navigate to** → ContactDetailScreen

### 4.5 Create Contact Detail Screen

1. Create new screen: `ContactDetailScreen`
2. Add components:
   - **Text:** "{{selectedContact.firstName}} {{selectedContact.lastName}}"
   - **Text:** "{{selectedContact.company}}"
   - **Text:** "Email Score: {{relationshipScore}}"
   - **Tabs:**
     - **Emails Tab:**
       - List of emails
       - On load: **Execute API Call** → **GetContactEmails**
     - **Meetings Tab:**
       - List of meetings
       - On meeting click: Navigate to MeetingDetailScreen
     - **Tasks Tab:**
       - List of tasks for this contact
     - **Timeline Tab:**
       - Show all interactions (emails + calls + meetings)

### 4.6 Create Email List Screen

1. Inside HomeScreen tab: `EmailsTab`
2. Add components:
   - **Search bar** (filters by subject/sender)
   - **List** (shows emailsList)
     - **Item components:**
       - From (text)
       - Subject (text)
       - Priority badge (high/medium/low with colors)
       - Received date (text)
       - Unread indicator (dot)
   - **Filter buttons:** All / Unread / High Priority / Action Required

3. On email click: Navigate to EmailDetailScreen

### 4.7 Create Email Detail Screen

1. Create new screen: `EmailDetailScreen`
2. Add components:
   - **Text:** From: {{selectedEmail.from}}
   - **Text:** Subject: {{selectedEmail.subject}}
   - **Text:** {{selectedEmail.body}}
   - **Text:** Received: {{selectedEmail.receivedAt}}
   - **Button:** "Reply"
   - **Button:** "Forward"
   - **Text:** "Linked Contact: {{linkedContact.name}}"
   - **Text:** "Linked Task: {{linkedTask.title}}"

### 4.8 Create Tasks Screen

1. Inside HomeScreen tab: `TasksTab`
2. Add components:
   - **Text:** "Priority List (AI-Ranked)"
   - **List** (shows tasksList sorted by priority)
     - **Item components:**
       - Title (text)
       - Priority bar (visual 0-100)
       - Due date (text, red if overdue)
       - Status (dropdown: open/in_progress/completed)
   - **Button:** "+ New Task"
   - **Filter buttons:** All / Overdue / High Priority / Completed

3. On task status change: Update task via API
4. On task click: Navigate to TaskDetailScreen

### 4.9 Create Task Detail Screen

1. Create new screen: `TaskDetailScreen`
2. Add components:
   - **Text:** {{task.title}}
   - **Text:** {{task.description}}
   - **Text:** "Priority: {{task.priority}}/100"
   - **Text:** "Due: {{task.dueDate}}"
   - **Dropdown:** Status
   - **Text:** "Contact: {{linkedContact.name}}"
   - **Button:** "Complete Task"
   - **Button:** "Edit"
   - **Button:** "Delete"

### 4.10 Create Meetings Screen

1. Inside HomeScreen tab: `MeetingsTab`
2. Add components:
   - **Calendar view** (shows upcoming meetings)
   - **List** (shows meetingsList)
     - **Item components:**
       - Title (text)
       - Time (text)
       - Attendees (text)
       - Status badge (upcoming/completed)
   - **Button:** "+ Schedule Meeting"

3. On meeting click: Navigate to MeetingDetailScreen

### 4.11 Create Meeting Detail Screen

1. Create new screen: `MeetingDetailScreen`
2. Add components:
   - **Text:** {{meeting.title}}
   - **Text:** "Time: {{meeting.startTime}} - {{meeting.endTime}}"
   - **Text:** "Attendees: {{meeting.attendees}}"
   - **Link:** "Join Video Call" (opens meeting.videoConferenceUrl)
   - **Tab Bar:**
     - **Summary Tab:**
       - Text: "Loading summary..." (on load: GetMeetingSummary)
       - Text: {{meetingSummary.summary}}
     - **Transcript Tab:**
       - Text: {{meeting.transcript}}
     - **Action Items Tab:**
       - List of action items
       - Checkboxes for completion

---

## Part 5: Connect Everything (30 minutes)

### 5.1 Set Up User Session Management

1. Go to **Settings** → **App State**
2. Create variables:
   - `authToken` (text)
   - `userEmail` (text)
   - `selectedContactId` (number)
   - `selectedEmailId` (number)
   - `selectedTaskId` (number)
   - `selectedMeetingId` (number)

### 5.2 Set Up Navigation

1. **Startup flow:**
   - App opens → LoginScreen
   - User logs in → Home screen (with dashboard)
   - User logs out → LoginScreen

2. **Navigation structure:**
   ```
   LoginScreen → SignUpScreen
             ↓
   HomeScreen (with tabs)
       ├─ ContactsTab → ContactDetailScreen
       ├─ EmailsTab → EmailDetailScreen
       ├─ TasksTab → TaskDetailScreen
       └─ MeetingsTab → MeetingDetailScreen
   ```

### 5.3 Add Search/Filter Functionality

1. On ContactsTab: Add search to filter contacts by name/email
2. On EmailsTab: Add filters for priority/read status
3. On TasksTab: Add filters for status/priority
4. On MeetingsTab: Add date range filter

### 5.4 Add Real-Time Updates

Adalo has limited real-time, so use:
1. **Pull-to-refresh** on each list
2. **Auto-refresh every 30 seconds** (optional)
3. **Manual refresh button** on each screen

---

## Part 6: Testing (30 minutes)

### 6.1 Test Registration

1. Open app in preview
2. Go to SignUpScreen
3. Create test account:
   - Email: test@example.com
   - Password: TestPassword123
   - First Name: Test
   - Last Name: User
4. Click Sign Up
5. Check backend logs: `heroku logs --tail`
6. Verify user created in database

### 6.2 Test Login

1. Go to LoginScreen
2. Login with test account
3. Verify redirects to HomeScreen
4. Verify authToken is saved

### 6.3 Test Contacts

1. On ContactsTab, verify it calls GetContacts API
2. Check backend logs for API call
3. If no contacts, create test contact via API:
   ```bash
   curl -X POST https://YOUR_APP_NAME.herokuapp.com/api/contacts \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "firstName": "Sarah",
       "lastName": "Johnson",
       "email": "sarah@example.com",
       "company": "Acme Corp"
     }'
   ```
4. Refresh Adalo app, verify contact appears

### 6.4 Test Email Integration

1. Create test email in backend:
   ```bash
   curl -X POST https://YOUR_APP_NAME.herokuapp.com/api/emails \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "from": "sarah@example.com",
       "to": "test@example.com",
       "subject": "Test Email",
       "body": "This is a test email",
       "contactId": 1
     }'
   ```
2. Go to EmailsTab in Adalo
3. Verify email appears in list
4. Click email, verify EmailDetailScreen shows content

### 6.5 Test Tasks

1. Create test task via API
2. Verify appears in TasksTab
3. Test priority ranking
4. Test status update

### 6.6 Test Meetings

1. Create test meeting via API
2. Verify appears in MeetingsTab
3. Test meeting detail screen
4. If meeting has summary, test summary display

---

## Part 7: Publish & Share (5 minutes)

### 7.1 Publish App

1. In Adalo, click **Publish**
2. Choose **Web** or **Native App**
3. Add app details:
   - Name: Executive Assistant AI
   - Description: AI-powered executive assistant
   - Icon: Upload logo
4. Click **Publish**

### 7.2 Get Public URL

Adalo generates a public link like:
```
https://executive-assistant-ai.adalo.com
```

Share this with users!

### 7.3 Set Up Custom Domain (Optional)

1. Purchase domain (GoDaddy, Namecheap, etc.)
2. In Adalo: **Settings** → **Domain**
3. Add your domain
4. Update DNS records

---

## Part 8: Troubleshooting

### API calls not working

1. Check backend is running:
   ```bash
   curl https://YOUR_APP_NAME.herokuapp.com/health
   ```

2. Check logs:
   ```bash
   heroku logs --tail
   ```

3. Verify headers in Adalo API call include Authorization

4. Test API directly with curl:
   ```bash
   curl https://YOUR_APP_NAME.herokuapp.com/api/contacts \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

### Data not appearing in Adalo

1. Verify API response format matches Adalo expectations
2. Check "Save response to variable" is enabled
3. Verify list component is bound to correct variable
4. Add Console logging to debug

### Login not working

1. Verify credentials are correct
2. Check database has user
3. Verify JWT secret is set
4. Check auth logs: `heroku logs --tail --grep "auth"`

### CORS errors

1. Update CORS in backend (`src/index.js`):
   ```javascript
   app.use(cors({
     origin: process.env.FRONTEND_URL, // Your Adalo URL
     credentials: true
   }));
   ```

2. Redeploy:
   ```bash
   git push heroku main
   ```

---

## Next Steps

Once MVP is working:

1. **Week 1-2:** Add Gmail real integration
   - Users click "Connect Gmail"
   - OAuth flow to Gmail
   - Sync emails to database
   - Display in app

2. **Week 3-4:** Add Google Calendar
   - Connect Google Calendar
   - Sync meetings
   - Show meeting details

3. **Week 5-6:** Add meeting transcription
   - Record Zoom meetings
   - Transcribe with Deepgram
   - Summarize with Claude
   - Display in app

4. **Week 7-8:** Add SMS/Twilio
   - Send SMS from Adalo
   - Receive SMS notifications
   - Log to contact record

---

## Support

**Heroku Issues:**
- Docs: https://devcenter.heroku.com
- Support: https://help.heroku.com

**Adalo Issues:**
- Docs: https://help.adalo.com
- Community: https://community.adalo.com

**Backend Issues:**
- Check logs: `heroku logs --tail`
- GitHub Issues: https://github.com/ataylor36902-alt/executive-assistant-ai/issues

