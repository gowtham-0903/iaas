from marshmallow import fields, validate

from app.extensions import BaseSchema
from app.models.candidate import CANDIDATE_STATUSES


class CandidateSchema(BaseSchema):
    id = fields.Int(dump_only=True)
    client_id = fields.Int(required=True)
    jd_id = fields.Int(required=True)
    full_name = fields.Str(required=True, validate=validate.Length(min=1, max=255))
    email = fields.Email(required=True, validate=validate.Length(max=255))
    status = fields.Str(validate=validate.OneOf(CANDIDATE_STATUSES), load_default="APPLIED")
    resume_url = fields.Str(dump_only=True)
    resume_filename = fields.Str(dump_only=True)
    phone = fields.Str(dump_only=True)
    ai_extracted = fields.Bool(dump_only=True)
    created_at = fields.DateTime(dump_only=True)


class CandidateUpdateSchema(BaseSchema):
    jd_id = fields.Int()
    full_name = fields.Str(validate=validate.Length(min=1, max=255))
    email = fields.Email(validate=validate.Length(max=255))
    phone = fields.Str(allow_none=True, validate=validate.Length(max=50))
    status = fields.Str(validate=validate.OneOf(CANDIDATE_STATUSES))


candidate_schema = CandidateSchema()
candidates_schema = CandidateSchema(many=True)
candidate_update_schema = CandidateUpdateSchema()
