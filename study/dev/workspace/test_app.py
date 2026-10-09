import pytest

from app import signup


def test_signup_succeeds_with_valid_input():
    result = signup("user@example.com", "hunter2")
    assert result == {"email": "user@example.com", "status": "created"}


def test_signup_rejects_empty_password():
    with pytest.raises(ValueError):
        signup("user@example.com", "")


def test_signup_rejects_empty_email():
    with pytest.raises(ValueError):
        signup("", "hunter2")
