import re

from marshmallow import ValidationError, fields, validate

from app.extensions import BaseSchema
from app.models.user import UserRole


def validate_password_strength(value: str) -> None:
    errors = []

    if len(value) < 8:
        errors.append("Minimum 8 characters")
    if not re.search(r"[A-Z]", value):
        errors.append("At least one uppercase letter")
    if not re.search(r"[a-z]", value):
        errors.append("At least one lowercase letter")
    if not re.search(r"\d", value):
        errors.append("At least one number")
    if not re.search(r"[^A-Za-z0-9]", value):
        errors.append("At least one special character")

    if errors:
        raise ValidationError(errors)


class UserSchema(BaseSchema):
    id = fields.Int(dump_only=True)
    full_name = fields.Str(required=True)
    email = fields.Email(required=True)
    role = fields.Str(required=True)
    client_id = fields.Int(allow_none=True)
    reports_to = fields.Int(allow_none=True)
    is_active = fields.Bool()
    created_at = fields.DateTime(dump_only=True)


class CreateUserSchema(BaseSchema):
    full_name = fields.Str(required=True)
    email = fields.Email(required=True)
    password = fields.Str(required=True, load_only=True, validate=validate_password_strength)
    role = fields.Str(required=True, validate=validate.OneOf([role.value for role in UserRole]))
    client_id = fields.Int(allow_none=True, load_default=None)
    reports_to = fields.Int(allow_none=True, load_default=None)
    is_active = fields.Bool(load_default=True)


class UpdateUserSchema(BaseSchema):
    full_name = fields.Str()
    email = fields.Email()
    password = fields.Str(load_only=True, validate=validate_password_strength, allow_none=True)
    role = fields.Str(validate=validate.OneOf([role.value for role in UserRole]))
    is_active = fields.Bool()
    client_id = fields.Int(allow_none=True)
    reports_to = fields.Int(allow_none=True)


user_schema = UserSchema()
users_schema = UserSchema(many=True)
create_user_schema = CreateUserSchema()
update_user_schema = UpdateUserSchema()
