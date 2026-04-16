from marshmallow import fields, validate

from app.extensions import BaseSchema


class ClientSchema(BaseSchema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True, validate=validate.Length(min=1, max=255))
    industry = fields.Str(required=True, validate=validate.Length(min=1, max=255))
    contact_email = fields.Email(required=True, validate=validate.Length(max=255))
    is_active = fields.Bool()
    created_at = fields.DateTime(dump_only=True)


client_schema = ClientSchema()
clients_schema = ClientSchema(many=True)