const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../../utils/logger');

/**
 * Claude AI Service
 * Provides AI-powered features:
 * - Meeting summarization
 * - Email drafting
 * - Action item extraction
 * - Relationship intelligence
 */
class ClaudeService {
  constructor() {
    this.client = new Anthropic();
    this.model = 'claude-3-5-sonnet-20241022';
  }

  /**
   * Generate meeting summary with action items
   */
  async generateMeetingSummary(transcription, meetingContext = {}) {
    try {
      logger.info('Generating meeting summary with Claude');

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `You are an executive assistant summarizing a meeting. Analyze the following transcription and provide:

1. Executive Summary (2-3 sentences)
2. Key Discussion Points (bullet list)
3. Action Items with owners and deadlines
4. Decisions Made
5. Next Steps

Meeting Context:
Title: ${meetingContext.title || 'N/A'}
Attendees: ${meetingContext.attendees?.join(', ') || 'N/A'}
Date: ${meetingContext.date || 'N/A'}

Transcription:
${transcription}

Provide output in structured JSON format.`,
          },
        ],
      });

      const response = message.content[0].type === 'text'
        ? JSON.parse(message.content[0].text)
        : null;

      logger.info('Meeting summary generated successfully');
      return response;
    } catch (error) {
      logger.error('Error generating meeting summary:', error);
      throw error;
    }
  }

  /**
   * Draft email response based on context
   */
  async draftEmailResponse(incomingEmail, context = {}) {
    try {
      logger.info('Drafting email response with Claude');

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `You are drafting a professional email response. Analyze the incoming email and draft a response.

Incoming Email:
From: ${incomingEmail.from}
Subject: ${incomingEmail.subject}
Body:
${incomingEmail.body}

Context:
- Sender relationship: ${context.relationship || 'Professional'}
- Response tone: ${context.tone || 'Professional'}
- Prior conversation: ${context.priorContext || 'First contact'}

Provide a draft response that is:
- Professional and courteous
- Concise (under 150 words)
- Action-oriented if applicable

Draft Response:`,
          },
        ],
      });

      const draftedEmail = message.content[0].type === 'text'
        ? message.content[0].text
        : null;

      logger.info('Email draft generated successfully');
      return draftedEmail;
    } catch (error) {
      logger.error('Error drafting email:', error);
      throw error;
    }
  }

  /**
   * Extract action items from transcription
   */
  async extractActionItems(transcription) {
    try {
      logger.info('Extracting action items with Claude');

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Extract all action items from this meeting transcription. For each action item, identify:
1. Description of the task
2. Owner (who is responsible)
3. Estimated deadline
4. Priority (high, medium, low)

Transcription:
${transcription}

Return as JSON array of objects with keys: description, owner, deadline, priority`,
          },
        ],
      });

      const actionItems = message.content[0].type === 'text'
        ? JSON.parse(message.content[0].text)
        : [];

      logger.info('Action items extracted successfully');
      return actionItems;
    } catch (error) {
      logger.error('Error extracting action items:', error);
      throw error;
    }
  }

  /**
   * Generate relationship intelligence briefing
   */
  async generateRelationshipBriefing(contactData, interactionHistory) {
    try {
      logger.info('Generating relationship briefing with Claude');

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Generate a concise executive briefing for an upcoming meeting or call.

Contact Information:
${JSON.stringify(contactData, null, 2)}

Recent Interaction History:
${JSON.stringify(interactionHistory, null, 2)}

Provide:
1. Relationship Summary (current status, history)
2. Key Points to Remember
3. Conversation Starters
4. Topics to Avoid
5. Suggested Follow-up Actions

Keep it concise and actionable.`,
          },
        ],
      });

      const briefing = message.content[0].type === 'text'
        ? message.content[0].text
        : null;

      logger.info('Relationship briefing generated successfully');
      return briefing;
    } catch (error) {
      logger.error('Error generating relationship briefing:', error);
      throw error;
    }
  }

  /**
   * Analyze email sentiment and priority
   */
  async analyzeEmailSentiment(emailBody) {
    try {
      logger.info('Analyzing email sentiment with Claude');

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: `Analyze the sentiment and priority of this email. Respond with JSON.

Email:
${emailBody}

Return JSON with:
- sentiment: 'positive', 'negative', or 'neutral'
- priority: 'high', 'medium', or 'low'
- urgency: boolean
- requires_response: boolean
- suggested_action: brief description`,
          },
        ],
      });

      const analysis = message.content[0].type === 'text'
        ? JSON.parse(message.content[0].text)
        : null;

      logger.info('Email analysis completed');
      return analysis;
    } catch (error) {
      logger.error('Error analyzing email sentiment:', error);
      throw error;
    }
  }

  /**
   * Generate follow-up nudge
   */
  async generateFollowUpNudge(contactName, lastInteractionDate, context = {}) {
    try {
      logger.info('Generating follow-up nudge with Claude');

      const daysAgo = Math.floor((Date.now() - new Date(lastInteractionDate)) / (1000 * 60 * 60 * 24));

      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: `Generate a brief, friendly follow-up message to re-engage a contact.

Contact: ${contactName}
Last interaction: ${daysAgo} days ago
Context: ${context.relationship || 'Professional contact'}
Prior topic: ${context.priorTopic || 'Not specified'}

Generate a concise, personalized follow-up message that:
- References the prior interaction
- Provides value or updates
- Suggests next steps
- Is warm but professional`,
          },
        ],
      });

      const nudge = message.content[0].type === 'text'
        ? message.content[0].text
        : null;

      logger.info('Follow-up nudge generated successfully');
      return nudge;
    } catch (error) {
      logger.error('Error generating follow-up nudge:', error);
      throw error;
    }
  }

  /**
   * Plugin system for Claude
   * Allows extending Claude capabilities via plugins
   */
  async executePluginFunction(pluginName, functionName, params) {
    try {
      logger.info(`Executing Claude plugin: ${pluginName}.${functionName}`);

      // Validate plugin exists
      const pluginRegistry = this.getPluginRegistry();
      if (!pluginRegistry[pluginName]) {
        throw new Error(`Plugin '${pluginName}' not found`);
      }

      const plugin = pluginRegistry[pluginName];

      // Call plugin function with Claude context
      const result = await plugin[functionName](this.client, params);

      return result;
    } catch (error) {
      logger.error('Error executing plugin function:', error);
      throw error;
    }
  }

  /**
   * Get plugin registry
   * Returns available Claude plugins
   */
  getPluginRegistry() {
    return {
      'research-plugin': require('./plugins/researchPlugin'),
      'calendar-assistant': require('./plugins/calendarPlugin'),
      'crm-integrator': require('./plugins/crmPlugin'),
      'financial-tracker': require('./plugins/financialPlugin'),
      'custom-plugin': require('./plugins/customPlugin'),
    };
  }
}

module.exports = new ClaudeService();
