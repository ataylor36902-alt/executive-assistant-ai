const { google } = require('googleapis');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');

class GmailService {
  constructor() {
    this.gmail = null;
  }

  /**
   * Initialize Gmail client with OAuth token
   */
  async initializeGmail(oauth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * Get Gmail profile info
   */
  async getProfile() {
    try {
      const res = await this.gmail.users.getProfile({ userId: 'me' });
      return res.data;
    } catch (error) {
      logger.error('Error getting Gmail profile:', error);
      throw error;
    }
  }

  /**
   * Fetch emails for a contact
   */
  async fetchEmailsForContact(contactEmail, maxResults = 10) {
    try {
      const query = `from:${contactEmail} OR to:${contactEmail}`;
      const res = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      if (!res.data.messages) return [];

      // Get full message details
      const emails = await Promise.all(
        res.data.messages.map((msg) => this.getMessageDetails(msg.id))
      );

      return emails;
    } catch (error) {
      logger.error(`Error fetching emails for ${contactEmail}:`, error);
      throw error;
    }
  }

  /**
   * Get full message details
   */
  async getMessageDetails(messageId) {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = res.data;
      const headers = message.payload.headers;

      return {
        id: messageId,
        threadId: message.threadId,
        from: headers.find((h) => h.name === 'From')?.value,
        to: headers.find((h) => h.name === 'To')?.value,
        subject: headers.find((h) => h.name === 'Subject')?.value,
        date: headers.find((h) => h.name === 'Date')?.value,
        body: this.getMessageBody(message.payload),
        labels: message.labelIds || [],
      };
    } catch (error) {
      logger.error(`Error getting message details for ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Extract body from message payload
   */
  getMessageBody(payload) {
    if (payload.parts) {
      const textPart = payload.parts.find((part) => part.mimeType === 'text/plain');
      if (textPart && textPart.body.data) {
        return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    }
    if (payload.body.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    return '';
  }

  /**
   * Send email
   */
  async sendEmail(to, subject, body, cc = [], bcc = []) {
    try {
      const email = [
        `To: ${to}`,
        ...(cc.length ? [`Cc: ${cc.join(',')}`] : []),
        ...(bcc.length ? [`Bcc: ${bcc.join(',')}`] : []),
        `Subject: ${subject}`,
        '',
        body,
      ].join('\n');

      const encodedEmail = Buffer.from(email).toString('base64');

      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
        },
      });

      return res.data;
    } catch (error) {
      logger.error('Error sending email:', error);
      throw error;
    }
  }

  /**
   * Watch for new emails (push notifications)
   */
  async watchMailbox() {
    try {
      await this.gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName: `projects/${process.env.GCP_PROJECT_ID}/topics/gmail-notifications`,
        },
      });
      logger.info('Gmail watch activated');
    } catch (error) {
      logger.error('Error setting up Gmail watch:', error);
      throw error;
    }
  }

  /**
   * Full email sync from Gmail to database
   */
  async syncAllEmails(userId, Email) {
    try {
      logger.info(`Starting email sync for user ${userId}`);
      const syncKey = `gmail_sync:${userId}`;
      const lastSyncTime = await redis.get(syncKey);

      // Query for new messages since last sync
      const query = lastSyncTime ? `after:${Math.floor(new Date(lastSyncTime).getTime() / 1000)}` : '';
      const res = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
      });

      if (!res.data.messages) {
        logger.info('No new emails to sync');
        return { synced: 0 };
      }

      // Get full details and save to database
      let syncedCount = 0;
      for (const message of res.data.messages) {
        try {
          const emailDetails = await this.getMessageDetails(message.id);
          await Email.findOrCreate({
            where: { gmailMessageId: message.id },
            defaults: {
              userId,
              gmailMessageId: message.id,
              subject: emailDetails.subject,
              from: emailDetails.from,
              to: emailDetails.to,
              body: emailDetails.body,
              labels: emailDetails.labels,
              receivedAt: new Date(emailDetails.date),
            },
          });
          syncedCount++;
        } catch (err) {
          logger.error(`Error syncing message ${message.id}:`, err);
        }
      }

      // Update last sync time
      await redis.set(syncKey, new Date().toISOString());
      logger.info(`Email sync completed. Synced ${syncedCount} emails`);
      return { synced: syncedCount };
    } catch (error) {
      logger.error('Error syncing emails:', error);
      throw error;
    }
  }
}

module.exports = new GmailService();
