"""Configured models extend built-in picker rows."""

from unittest.mock import patch

from hermes_cli.model_switch import list_authenticated_providers


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
