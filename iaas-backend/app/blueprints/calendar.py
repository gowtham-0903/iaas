from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text
from app.extensions import db
from app.models.user import User

calendar_bp = Blueprint('calendar', __name__)

STATUS_COLORS = {
    'SCHEDULED': '#F59E0B',
    'IN_PROGRESS': '#3B82F6',
    'COMPLETED': '#10B981',
    'CANCELLED': '#EF4444',
    'ABSENT': '#6B7280',
}


@calendar_bp.route('/events', methods=['GET'])
@jwt_required()
def get_calendar_events():
    identity = get_jwt_identity()
    user = User.query.get(identity)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    start = request.args.get('start')
    end = request.args.get('end')
    client_id = request.args.get('client_id', type=int)
    status_filter = request.args.get('status')

    conditions = ['1=1']
    params = {}

    if start:
        conditions.append('i.scheduled_at >= :start')
        params['start'] = start
    if end:
        conditions.append('i.scheduled_at <= :end')
        params['end'] = end
    if status_filter:
        conditions.append('i.status = :status')
        params['status'] = status_filter.upper()

    if user.role == 'OPERATOR':
        conditions.append(
            'cl.id IN (SELECT client_id FROM operator_client_assignments WHERE user_id = :user_id)'
        )
        params['user_id'] = user.id
    elif user.role == 'CLIENT':
        conditions.append('cl.id = :client_filter')
        params['client_filter'] = user.client_id
    elif user.role in ('RECRUITER', 'SR_RECRUITER', 'M_RECRUITER'):
        conditions.append(
            'i.jd_id IN (SELECT jd_id FROM jd_recruiter_assignments WHERE user_id = :user_id)'
        )
        params['user_id'] = user.id

    if client_id and user.role in ('ADMIN', 'QC'):
        conditions.append('cl.id = :client_id')
        params['client_id'] = client_id

    where_clause = ' AND '.join(conditions)
    sql = f"""
        SELECT
            i.id,
            i.scheduled_at,
            i.duration_minutes,
            i.status,
            i.meeting_link,
            i.timezone,
            c.full_name AS candidate_name,
            jd.title AS job_title,
            cl.id AS client_id,
            cl.name AS client_name
        FROM interview_schedules i
        JOIN candidates c ON c.id = i.candidate_id
        JOIN job_descriptions jd ON jd.id = i.jd_id
        JOIN clients cl ON cl.id = jd.client_id
        WHERE {where_clause}
        ORDER BY i.scheduled_at ASC
    """

    rows = db.session.execute(text(sql), params).mappings().all()

    events = []
    for row in rows:
        panelist_rows = db.session.execute(text("""
            SELECT p.name, p.email
            FROM panel_assignments pa
            JOIN panelists p ON p.id = pa.panelist_id
            WHERE pa.interview_id = :iid
        """), {'iid': row['id']}).mappings().all()

        scheduled_at = row['scheduled_at']
        if not isinstance(scheduled_at, datetime):
            scheduled_at = datetime.fromisoformat(str(scheduled_at))

        duration = row['duration_minutes'] or 60
        end_dt = scheduled_at + timedelta(minutes=duration)
        status = row['status'] or 'SCHEDULED'

        events.append({
            'id': row['id'],
            'start_date': scheduled_at.strftime('%Y-%m-%dT%H:%M:%S'),
            'end_date': end_dt.strftime('%Y-%m-%dT%H:%M:%S'),
            'text': f"{row['candidate_name']} — {row['job_title']}",
            'status': status,
            'color': STATUS_COLORS.get(status, '#94A3B8'),
            'candidate_name': row['candidate_name'],
            'job_title': row['job_title'],
            'client_name': row['client_name'],
            'client_id': row['client_id'],
            'meeting_link': row['meeting_link'],
            'timezone': row['timezone'],
            'panelists': [{'name': p['name'], 'email': p['email']} for p in panelist_rows],
        })

    return jsonify({'events': events})
