from marshmallow import fields

from app.extensions import BaseSchema


class UserSchema(BaseSchema):
    id = fields.Int(dump_only=True)
    full_name = fields.Str(required=True)
    email = fields.Email(required=True)
    role = fields.Str(required=True)
    client_id = fields.Int(allow_none=True)
    reports_to = fields.Int(allow_none=True)
    is_active = fields.Bool()
    created_at = fields.DateTime(dump_only=True)


user_schema = UserSchema()
users_schema = UserSchema(many=True)
