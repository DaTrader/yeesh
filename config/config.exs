import Config

# Enable the built-in `mix` command during library development and testing.
# Consumers must opt in via `config :yeesh, enable_mix_command: true`.
if config_env() in [:dev, :test] do
  config :yeesh, enable_mix_command: true
end
