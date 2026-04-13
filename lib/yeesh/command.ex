defmodule Yeesh.Command do
  @moduledoc """
  Behaviour for defining terminal commands.

  Implement this behaviour to create custom commands that can be
  executed in the Yeesh terminal.

  ## Example

      defmodule MyApp.Commands.Ping do
        @behaviour Yeesh.Command

        @impl true
        def name, do: "ping"

        @impl true
        def description, do: "Responds with pong"

        @impl true
        def usage, do: "ping"

        @impl true
        def completions(_partial, _session), do: []

        @impl true
        def execute(_args, session) do
          {:ok, "pong", session}
        end
      end

  ## Explicit group

  Implement the optional `group/0` callback to control how the command
  is grouped in the `help` output. Without it, grouping is derived from
  the command name (split on `.`, `-`, or `_`).

      defmodule MyApp.Commands.Migrate do
        @behaviour Yeesh.Command

        @impl true
        def name, do: "db.migrate"

        @impl true
        def group, do: "Database"

        @impl true
        def description, do: "Run database migrations"

        @impl true
        def usage, do: "db.migrate [--step N]"

        @impl true
        def execute(_args, session), do: {:ok, "Migrated", session}
      end
  """

  @type session :: Yeesh.Session.t()

  @doc "The command name used to invoke it from the terminal."
  @callback name() :: String.t()

  @doc "A short description shown in help output."
  @callback description() :: String.t()

  @doc "Usage string shown when the user requests help for this command."
  @callback usage() :: String.t()

  @doc """
  Returns a list of possible completions given a partial input and session state.
  Called when the user presses Tab.
  """
  @callback completions(partial :: String.t(), session :: session()) :: [String.t()]

  @doc """
  Returns the group name for the `help` command output.

  When implemented, this takes precedence over the automatic grouping
  derived from the command name. The returned string is used as-is
  for the group header.

  When not implemented, commands are grouped by splitting the name on
  `.`, `-`, or `_` and capitalizing the first segment. Commands with
  no separator appear under "Generic".
  """
  @callback group() :: String.t()

  @doc """
  Executes the command with the given arguments.

  Returns `{:ok, output, updated_session}` on success,
  or `{:error, reason, updated_session}` on failure.

  The session may be updated (e.g. to set environment variables).

  Execution is currently synchronous. Async streaming execution
  is planned for Milestone 3.
  """
  @callback execute(args :: [String.t()], session :: session()) ::
              {:ok, output :: String.t(), session()}
              | {:error, reason :: String.t(), session()}

  @optional_callbacks [completions: 2, group: 0]
end
