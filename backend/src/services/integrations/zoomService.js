const axios = require('axios');
const logger = require('../../utils/logger');
const jwt = require('jsonwebtoken');

class ZoomService {
  constructor() {
    this.baseURL = 'https://api.zoom.us/v2';
  }

  /**
   * Generate Zoom JWT token
   */
  generateZoomJWT() {
    const payload = {
      iss: process.env.ZOOM_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
    };

    return jwt.sign(payload, process.env.ZOOM_CLIENT_SECRET);
  }

  /**
   * Create Zoom meeting
   */
  async createMeeting(userId, meetingData) {
    try {
      const token = this.generateZoomJWT();
      const res = await axios.post(`${this.baseURL}/users/${userId}/meetings`, {
        topic: meetingData.topic,
        type: 2, // Scheduled meeting
        start_time: meetingData.startTime,
        duration: meetingData.duration,
        timezone: meetingData.timezone || 'UTC',
        settings: {
          host_video: true,
          participant_video: true,
          join_before_host: true,
          auto_recording: 'cloud',
        },
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info(`Zoom meeting created: ${res.data.id}`);
      return res.data;
    } catch (error) {
      logger.error('Error creating Zoom meeting:', error);
      throw error;
    }
  }

  /**
   * Get meeting details
   */
  async getMeetingDetails(meetingId) {
    try {
      const token = this.generateZoomJWT();
      const res = await axios.get(`${this.baseURL}/meetings/${meetingId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return res.data;
    } catch (error) {
      logger.error(`Error getting meeting ${meetingId}:`, error);
      throw error;
    }
  }

  /**
   * Get meeting recordings
   */
  async getMeetingRecordings(meetingId) {
    try {
      const token = this.generateZoomJWT();
      const res = await axios.get(`${this.baseURL}/meetings/${meetingId}/recordings`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return res.data.recording_files || [];
    } catch (error) {
      logger.error(`Error getting recordings for ${meetingId}:`, error);
      throw error;
    }
  }

  /**
   * Delete meeting
   */
  async deleteMeeting(meetingId) {
    try {
      const token = this.generateZoomJWT();
      await axios.delete(`${this.baseURL}/meetings/${meetingId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      logger.info(`Zoom meeting deleted: ${meetingId}`);
    } catch (error) {
      logger.error(`Error deleting meeting ${meetingId}:`, error);
      throw error;
    }
  }
}

module.exports = new ZoomService();
