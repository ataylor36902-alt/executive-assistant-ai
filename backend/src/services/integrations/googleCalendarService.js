const { google } = require('googleapis');
const logger = require('../../utils/logger');
const redis = require('../../config/redis');

class GoogleCalendarService {
  constructor() {
    this.calendar = null;
  }

  /**
   * Initialize Google Calendar client
   */
  async initializeCalendar(oauth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  }

  /**
   * List all calendars
   */
  async listCalendars() {
    try {
      const res = await this.calendar.calendarList.list();
      return res.data.items;
    } catch (error) {
      logger.error('Error listing calendars:', error);
      throw error;
    }
  }

  /**
   * Get events for a calendar
   */
  async getEvents(calendarId = 'primary', timeMin, timeMax, maxResults = 10) {
    try {
      const res = await this.calendar.events.list({
        calendarId,
        timeMin: timeMin || new Date().toISOString(),
        timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return res.data.items || [];
    } catch (error) {
      logger.error('Error fetching events:', error);
      throw error;
    }
  }

  /**
   * Create calendar event
   */
  async createEvent(calendarId = 'primary', eventData) {
    try {
      const event = {
        summary: eventData.summary,
        description: eventData.description,
        start: {
          dateTime: eventData.startTime,
          timeZone: eventData.timezone || 'UTC',
        },
        end: {
          dateTime: eventData.endTime,
          timeZone: eventData.timezone || 'UTC',
        },
        attendees: eventData.attendees || [],
        conferenceData: eventData.videoConference ? {
          requestId: `${Date.now()}`,
          conferenceSolution: {
            key: { conferenceSolutionKey: 'hangoutsMeet' },
          },
        } : undefined,
      };

      const res = await this.calendar.events.insert({
        calendarId,
        requestBody: event,
        conferenceDataVersion: 1,
      });

      return res.data;
    } catch (error) {
      logger.error('Error creating event:', error);
      throw error;
    }
  }

  /**
   * Update calendar event
   */
  async updateEvent(calendarId = 'primary', eventId, eventData) {
    try {
      const res = await this.calendar.events.update({
        calendarId,
        eventId,
        requestBody: eventData,
      });

      return res.data;
    } catch (error) {
      logger.error('Error updating event:', error);
      throw error;
    }
  }

  /**
   * Find available time slots
   */
  async findAvailableSlots(attendeeEmails, duration = 60, daysAhead = 7) {
    try {
      const availableSlots = [];
      const now = new Date();

      for (let day = 0; day < daysAhead; day++) {
        const dayStart = new Date(now);
        dayStart.setDate(dayStart.getDate() + day);
        dayStart.setHours(9, 0, 0, 0);

        const dayEnd = new Date(dayStart);
        dayEnd.setHours(17, 0, 0, 0);

        // Get busy times for all attendees
        const busyTimes = await this.getBusyTimes(attendeeEmails, dayStart, dayEnd);

        // Find free slots
        const freeSlots = this.calculateFreeSlots(dayStart, dayEnd, busyTimes, duration);
        availableSlots.push(...freeSlots);
      }

      return availableSlots;
    } catch (error) {
      logger.error('Error finding available slots:', error);
      throw error;
    }
  }

  /**
   * Get busy times for attendees
   */
  async getBusyTimes(attendeeEmails, timeMin, timeMax) {
    try {
      const res = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: attendeeEmails.map((email) => ({ id: email })),
        },
      });

      return res.data.calendars;
    } catch (error) {
      logger.error('Error getting busy times:', error);
      throw error;
    }
  }

  /**
   * Calculate free slots
   */
  calculateFreeSlots(dayStart, dayEnd, busyTimes, duration) {
    const slots = [];
    const workDayStart = new Date(dayStart);
    workDayStart.setHours(9, 0, 0, 0);
    const workDayEnd = new Date(dayStart);
    workDayEnd.setHours(17, 0, 0, 0);

    // Flatten busy times
    const busyPeriods = [];
    Object.values(busyTimes).forEach((calendar) => {
      if (calendar.busy) {
        busyPeriods.push(...calendar.busy.map((period) => ({
          start: new Date(period.start),
          end: new Date(period.end),
        })));
      }
    });

    // Sort busy periods
    busyPeriods.sort((a, b) => a.start - b.start);

    // Find gaps
    let currentTime = workDayStart;
    for (const busy of busyPeriods) {
      if (currentTime < busy.start) {
        const gapDuration = (busy.start - currentTime) / (1000 * 60);
        if (gapDuration >= duration) {
          slots.push({
            start: new Date(currentTime),
            end: new Date(currentTime.getTime() + duration * 60 * 1000),
          });
        }
      }
      currentTime = busy.end;
    }

    // Check final gap
    if (currentTime < workDayEnd) {
      const gapDuration = (workDayEnd - currentTime) / (1000 * 60);
      if (gapDuration >= duration) {
        slots.push({
          start: new Date(currentTime),
          end: new Date(currentTime.getTime() + duration * 60 * 1000),
        });
      }
    }

    return slots;
  }

  /**
   * Watch for calendar changes
   */
  async watchCalendar(calendarId = 'primary') {
    try {
      await this.calendar.events.watch({
        calendarId,
        requestBody: {
          id: `watch_${Date.now()}`,
          type: 'web_hook',
          address: `${process.env.API_URL}/webhooks/calendar`,
        },
      });
      logger.info('Calendar watch activated');
    } catch (error) {
      logger.error('Error setting up calendar watch:', error);
      throw error;
    }
  }
}

module.exports = new GoogleCalendarService();
