"""Configured models extend built-in picker rows."""

from unittest.mock import patch

from hermes_cli.model_switch import list_authenticated_providers
from hermes_cli.providers import HermesOverlay


def _provider_row(configured_models, *, max_models=None, discover_models=None):
    provider_cfg = {"models": configured_models}
    if discover_models is not None:
        provider_cfg["discover_models"] = discover_models
    with (
        patch(
            "agent.models_dev.fetch_models_dev",
            return_value={"deepseek": {"env": ["DEEPSEEK_API_KEY"], "name": "DeepSeek"}},
        ),
        patch(
            "agent.models_dev.PROVIDER_TO_MODELS_DEV",
            {"deepseek": "deepseek"},
        ),
        patch(
            "hermes_cli.models.cached_provider_model_ids",
            return_value=["live-a", "shared"],
        ),
        patch("hermes_cli.providers.HERMES_OVERLAYS", {}),
        patch.dict("os.environ", {"DEEPSEEK_API_KEY": "test-key"}),
    ):
        rows = list_authenticated_providers(
            current_provider="deepseek",
            user_providers={"deepseek": provider_cfg},
            max_models=max_models,
        )
    return next(row for row in rows if row["slug"] == "deepseek")


def test_configured_models_precede_and_deduplicate_discovered_models():
    row = _provider_row({"configured-x": {}, "shared": {}})

    assert row["models"] == ["configured-x", "shared", "live-a"]
    assert row["total_models"] == 3


def test_discover_models_false_uses_configured_list_verbatim():
    row = _provider_row(
        {"configured-x": {}, "configured-y": {}},
        discover_models=False,
    )

    assert row["models"] == ["configured-x", "configured-y"]
    assert row["total_models"] == 2


def test_discover_models_true_default_still_merges():
    # Regression guard: default (discover_models omitted/true) behavior
    # is unchanged — live/curated still merges with configured models.
    row = _provider_row({"configured-x": {}}, discover_models=True)

    assert row["models"] == ["configured-x", "live-a", "shared"]


def _anthropic_row(configured_models, *, discover_models=None):
    """Section-2 (HERMES_OVERLAYS) anthropic row, gated by an OAuth token.

    anthropic resolves through HERMES_OVERLAYS, not PROVIDER_TO_MODELS_DEV
    (section 1), so this exercises the overlay path that the production
    sandbox hits when ANTHROPIC_BASE_URL points at a non-anthropic gateway.
    """
    provider_cfg = {"models": configured_models}
    if discover_models is not None:
        provider_cfg["discover_models"] = discover_models
    with (
        patch(
            "agent.models_dev.fetch_models_dev",
            return_value={},
        ),
        patch(
            "agent.models_dev.PROVIDER_TO_MODELS_DEV",
            {},
        ),
        patch(
            "hermes_cli.models.cached_provider_model_ids",
            return_value=["claude-builtin-a", "claude-builtin-b"],
        ),
        patch(
            "hermes_cli.providers.HERMES_OVERLAYS",
            {"anthropic": HermesOverlay(transport="anthropic_messages", extra_env_vars=("CLAUDE_CODE_OAUTH_TOKEN",))},
        ),
        patch(
            "hermes_cli.auth._load_auth_store",
            return_value={"providers": {"anthropic": {}}},
        ),
        patch.dict("os.environ", {"CLAUDE_CODE_OAUTH_TOKEN": "test-token"}),
    ):
        rows = list_authenticated_providers(
            current_provider="custom:custom",
            user_providers={"anthropic": provider_cfg},
        )
    return next(row for row in rows if row["slug"] == "anthropic")


def test_anthropic_discover_models_false_uses_configured_list_verbatim():
    # Section-2 (HERMES_OVERLAYS) path: discover_models: false must narrow
    # the anthropic row to exactly the configured models, skipping the
    # built-in curated + live merge.
    row = _anthropic_row(
        {"global.anthropic.claude-opus-5[1m]": {}, "global.anthropic.claude-sonnet-5[1m]": {}},
        discover_models=False,
    )

    assert row["models"] == [
        "global.anthropic.claude-opus-5[1m]",
        "global.anthropic.claude-sonnet-5[1m]",
    ]
    assert row["total_models"] == 2
