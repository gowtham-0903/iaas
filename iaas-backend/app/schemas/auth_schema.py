from marshmallow import fields, validate

from app.extensions import BaseSchema


class LoginSchema(BaseSchema):
    email = fields.Email(required=True)
    password = fields.Str(required=True, validate=validate.Length(min=8))


login_schema = LoginSchema()
