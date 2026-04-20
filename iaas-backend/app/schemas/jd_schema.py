from marshmallow import fields, validate

from app.extensions import BaseSchema


class JDSkillSchema(BaseSchema):
    id = fields.Int(dump_only=True)
    jd_id = fields.Int(dump_only=True)
    skill_name = fields.Str(required=True)
    skill_type = fields.Str(required=True, validate=validate.OneOf(["primary", "secondary", "soft"]))
    importance_level = fields.Str(allow_none=True)
    subtopics = fields.List(fields.Str(), allow_none=True)


class JDSkillCreateSchema(BaseSchema):
    skill_name = fields.Str(required=True, validate=validate.Length(min=1, max=255))
    skill_type = fields.Str(required=True, validate=validate.OneOf(["primary", "secondary", "soft"]))
    importance_level = fields.Str(allow_none=True, validate=validate.Length(max=50))
    subtopics = fields.List(fields.Str(), allow_none=True)


class JDSkillUpdateSchema(BaseSchema):
    skill_name = fields.Str(required=True, validate=validate.Length(min=1, max=255))
    importance_level = fields.Str(allow_none=True, validate=validate.Length(max=50))
    subtopics = fields.List(fields.Str(), allow_none=True)


class JDSchema(BaseSchema):
    id = fields.Int(dump_only=True)
    client_id = fields.Int(required=True)
    title = fields.Str(required=True, validate=validate.Length(min=1, max=255))
    job_code = fields.Str(dump_only=True, allow_none=True)
    raw_text = fields.Str(load_default=None, allow_none=True)
    file_url = fields.Str(load_default=None, allow_none=True, validate=validate.Length(max=500))
    status = fields.Str(validate=validate.OneOf(["DRAFT", "ACTIVE", "CLOSED"]))
    created_by = fields.Int(dump_only=True)
    created_at = fields.DateTime(dump_only=True)
    skills = fields.Nested(JDSkillSchema, many=True, dump_only=True)


jd_schema = JDSchema()
jds_schema = JDSchema(many=True)
jd_skill_schema = JDSkillSchema()
jd_skills_schema = JDSkillSchema(many=True)
jd_skill_create_schema = JDSkillCreateSchema()
jd_skill_update_schema = JDSkillUpdateSchema()