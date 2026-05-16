import { useEffect, useRef } from 'react'
import { EventCalendar } from '@dhx/trial-eventcalendar'
import '@dhx/trial-eventcalendar/dist/event-calendar.css'

function toDhxEvents(events) {
  return events.map(e => ({
    id: e.id,
    start_date: new Date(e.start_date),
    end_date: new Date(e.end_date),
    text: e.text,
    color: e.color,
  }))
}

export default function CalendarWrapper({ events, onEventClick }) {
  const containerRef = useRef(null)
  const calendarRef = useRef(null)
  const onEventClickRef = useRef(onEventClick)

  useEffect(() => {
    onEventClickRef.current = onEventClick
  }, [onEventClick])

  useEffect(() => {
    if (!containerRef.current) return

    if (calendarRef.current) {
      calendarRef.current.destructor()
      calendarRef.current = null
    }

    const calendar = new EventCalendar(containerRef.current, {
      events: toDhxEvents(events),
      mode: 'week',
      date: new Date(),
      config: {
        readonly: true,
      },
    })

    calendar.api.on('select-event', ({ id }) => {
      const event = events.find(e => String(e.id) === String(id))
      if (event && onEventClickRef.current) {
        onEventClickRef.current(event)
      }
    })

    calendarRef.current = calendar

    return () => {
      if (calendarRef.current) {
        calendarRef.current.destructor()
        calendarRef.current = null
      }
    }
  }, [events]) // recreate when events change (filter reload)

  return <div ref={containerRef} style={{ height: '600px', width: '100%' }} />
}
