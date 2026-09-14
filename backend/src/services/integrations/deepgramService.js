const { Deepgram } = require('@deepgram/sdk');
const logger = require('../../utils/logger');

class DeepgramService {
  constructor() {
    this.deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
  }

  /**
   * Transcribe audio file
   */
  async transcribeFile(audioBuffer, mimeType = 'audio/wav') {
    try {
      const response = await this.deepgram.transcription.preRecorded(
        {
          buffer: audioBuffer,
          mimetype: mimeType,
        },
        {
          model: 'nova-2',
          smart_format: true,
          diarize: true, // Speaker identification
        }
      );

      logger.info('Transcription completed');
      return response;
    } catch (error) {
      logger.error('Error transcribing file:', error);
      throw error;
    }
  }

  /**
   * Live transcription (for real-time meetings)
   */
  async startLiveTranscription(audioStream) {
    try {
      const connection = await this.deepgram.listen.live({
        model: 'nova-2',
        smart_format: true,
        diarize: true,
      });

      connection.on('open', () => {
        logger.info('Live transcription connection opened');
        audioStream.pipe(connection);
      });

      connection.on('results', (data) => {
        if (data.is_final) {
          logger.debug('Transcription result:', data.channel.alternatives[0].transcript);
        }
      });

      connection.on('error', (err) => {
        logger.error('Live transcription error:', err);
      });

      return connection;
    } catch (error) {
      logger.error('Error starting live transcription:', error);
      throw error;
    }
  }

  /**
   * Extract key phrases from transcription
   */
  extractKeyPhrases(transcription) {
    // Simple implementation - could be enhanced with ML
    const keywords = ['decision', 'action item', 'next step', 'follow up', 'budget', 'approved', 'deadline'];
    const phrases = [];

    keywords.forEach((keyword) => {
      const regex = new RegExp(`[^.!?]*${keyword}[^.!?]*[.!?]`, 'gi');
      const matches = transcription.match(regex);
      if (matches) {
        phrases.push(...matches);
      }
    });

    return phrases;
  }
}

module.exports = new DeepgramService();
