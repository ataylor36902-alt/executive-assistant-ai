const twilio = require('twilio');
const logger = require('../../utils/logger');

class TwilioService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  }

  /**
   * Send SMS message
   */
  async sendSMS(toNumber, message) {
    try {
      const sms = await this.client.messages.create({
        body: message,
        from: this.phoneNumber,
        to: toNumber,
      });

      logger.info(`SMS sent to ${toNumber}: ${sms.sid}`);
      return sms;
    } catch (error) {
      logger.error('Error sending SMS:', error);
      throw error;
    }
  }

  /**
   * Send WhatsApp message
   */
  async sendWhatsApp(toNumber, message) {
    try {
      const msg = await this.client.messages.create({
        body: message,
        from: `whatsapp:${this.phoneNumber}`,
        to: `whatsapp:${toNumber}`,
      });

      logger.info(`WhatsApp sent to ${toNumber}: ${msg.sid}`);
      return msg;
    } catch (error) {
      logger.error('Error sending WhatsApp:', error);
      throw error;
    }
  }

  /**
   * Make phone call
   */
  async makeCall(toNumber, scriptUrl) {
    try {
      const call = await this.client.calls.create({
        url: scriptUrl,
        to: toNumber,
        from: this.phoneNumber,
        record: true,
      });

      logger.info(`Call initiated to ${toNumber}: ${call.sid}`);
      return call;
    } catch (error) {
      logger.error('Error making call:', error);
      throw error;
    }
  }

  /**
   * Send voice message
   */
  async sendVoiceMessage(toNumber, message) {
    try {
      // Convert text to speech and send as voice call
      const call = await this.client.calls.create({
        twiml: `<Response><Say>${message}</Say></Response>`,
        to: toNumber,
        from: this.phoneNumber,
      });

      logger.info(`Voice message sent to ${toNumber}: ${call.sid}`);
      return call;
    } catch (error) {
      logger.error('Error sending voice message:', error);
      throw error;
    }
  }

  /**
   * Transcribe voicemail
   */
  async transcribeVoicemail(recordingUrl) {
    try {
      // Fetch recording and transcribe using Deepgram or Speech-to-Text API
      logger.info('Transcribing voicemail from:', recordingUrl);

      // TODO: Implement voicemail transcription
      return { transcript: 'Transcription here' };
    } catch (error) {
      logger.error('Error transcribing voicemail:', error);
      throw error;
    }
  }
}

module.exports = new TwilioService();
