import axiosInstance from './axiosInstance'

export function getCalendarEvents(params = {}) {
  return axiosInstance.get('/api/calendar/events', { params })
}
