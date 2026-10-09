def validate_signup(email: str, password: str) -> None:
    """Validate signup form input.

    Raises ValueError if the input is invalid.
    """
    if password is None or password == "":
        raise ValueError("Password is required")


def signup(email: str, password: str) -> dict:
    """Create a new account after validating the input."""
    validate_signup(email, password)
    return {"email": email, "status": "created"}
