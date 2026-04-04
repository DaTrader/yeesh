defmodule Yeesh.SessionTest do
  use ExUnit.Case, async: true

  alias Yeesh.Session

  setup do
    {:ok, pid} = Session.start_link(prompt: "test> ", history_max_size: 5)
    %{pid: pid}
  end

  describe "history" do
    test "push and retrieve history", %{pid: pid} do
      Session.push_history(pid, "echo hello")
      Session.push_history(pid, "help")

      history = Session.get_history(pid)
      assert [_, _] = history
      assert "help" in history
      assert "echo hello" in history
    end

    test "history respects max size", %{pid: pid} do
      for i <- 1..10, do: Session.push_history(pid, "cmd #{i}")
      # Need a small delay for casts to process
      Process.sleep(10)
      history = Session.get_history(pid)
      assert length(history) == 5
    end

    test "ignores blank lines", %{pid: pid} do
      Session.push_history(pid, "  ")
      Session.push_history(pid, "")
      Process.sleep(10)
      assert [] = Session.get_history(pid)
    end

    test "history navigation", %{pid: pid} do
      Session.push_history(pid, "first")
      Session.push_history(pid, "second")
      Process.sleep(10)

      assert {:ok, "second"} = Session.history_prev(pid)
      assert {:ok, "first"} = Session.history_prev(pid)
      assert {:ok, "second"} = Session.history_next(pid)
      assert :end = Session.history_next(pid)
    end

    test "deduplicates consecutive identical commands", %{pid: pid} do
      Session.push_history(pid, "echo hello")
      Session.push_history(pid, "echo hello")
      Session.push_history(pid, "echo hello")
      Process.sleep(10)

      assert [_] = Session.get_history(pid)
    end

    test "allows same command non-consecutively", %{pid: pid} do
      Session.push_history(pid, "echo hello")
      Session.push_history(pid, "help")
      Session.push_history(pid, "echo hello")
      Process.sleep(10)

      assert [_, _, _] = Session.get_history(pid)
    end
  end

  describe "prefix-filtered history navigation" do
    test "filters by prefix when provided", %{pid: pid} do
      Session.push_history(pid, "help")
      Session.push_history(pid, "echo first")
      Session.push_history(pid, "env FOO=bar")
      Session.push_history(pid, "echo second")
      Process.sleep(10)

      # Only "echo" entries: ["echo second", "echo first"]
      assert {:ok, "echo second"} = Session.history_prev(pid, "echo")
      assert {:ok, "echo first"} = Session.history_prev(pid, "echo")
      # At oldest match, stays put (standard terminal behavior)
      assert {:ok, "echo first"} = Session.history_prev(pid, "echo")
    end

    test "navigates back down through filtered history", %{pid: pid} do
      Session.push_history(pid, "echo first")
      Session.push_history(pid, "help")
      Session.push_history(pid, "echo second")
      Process.sleep(10)

      assert {:ok, "echo second"} = Session.history_prev(pid, "echo")
      assert {:ok, "echo first"} = Session.history_prev(pid, "echo")
      assert {:ok, "echo second"} = Session.history_next(pid, "echo")
      assert :end = Session.history_next(pid, "echo")
    end

    test "changing prefix resets navigation index", %{pid: pid} do
      Session.push_history(pid, "help")
      Session.push_history(pid, "echo first")
      Session.push_history(pid, "echo second")
      Process.sleep(10)

      # Navigate with "echo" prefix
      assert {:ok, "echo second"} = Session.history_prev(pid, "echo")
      assert {:ok, "echo first"} = Session.history_prev(pid, "echo")

      # Switch prefix to "help" -- index should reset
      assert {:ok, "help"} = Session.history_prev(pid, "help")
    end

    test "nil prefix shows all history (backward compat)", %{pid: pid} do
      Session.push_history(pid, "first")
      Session.push_history(pid, "second")
      Process.sleep(10)

      assert {:ok, "second"} = Session.history_prev(pid, nil)
      assert {:ok, "first"} = Session.history_prev(pid, nil)
    end
  end

  describe "history_search" do
    test "finds matching entry by substring", %{pid: pid} do
      Session.push_history(pid, "echo hello")
      Session.push_history(pid, "help")
      Session.push_history(pid, "env set FOO=bar")
      Process.sleep(10)

      assert {:ok, "env set FOO=bar"} = Session.history_search(pid, "FOO")
      assert {:ok, "echo hello"} = Session.history_search(pid, "echo")
    end

    test "returns :no_match when nothing matches", %{pid: pid} do
      Session.push_history(pid, "echo hello")
      Process.sleep(10)

      assert :no_match = Session.history_search(pid, "nonexistent")
    end

    test "skip cycles through multiple matches", %{pid: pid} do
      Session.push_history(pid, "echo first")
      Session.push_history(pid, "echo second")
      Session.push_history(pid, "echo third")
      Process.sleep(10)

      # History is stored most-recent-first: ["echo third", "echo second", "echo first"]
      assert {:ok, "echo third"} = Session.history_search(pid, "echo", 0)
      assert {:ok, "echo second"} = Session.history_search(pid, "echo", 1)
      assert {:ok, "echo first"} = Session.history_search(pid, "echo", 2)
      assert :no_match = Session.history_search(pid, "echo", 3)
    end

    test "returns :no_match on empty history", %{pid: pid} do
      assert :no_match = Session.history_search(pid, "anything")
    end

    test "empty query matches all entries", %{pid: pid} do
      Session.push_history(pid, "echo hello")
      Session.push_history(pid, "help")
      Process.sleep(10)

      assert {:ok, "help"} = Session.history_search(pid, "")
      assert {:ok, "echo hello"} = Session.history_search(pid, "", 1)
    end
  end

  describe "prompt" do
    test "returns configured prompt", %{pid: pid} do
      assert "test> " = Session.get_prompt(pid)
    end

    test "returns iex prompt in elixir_repl mode", %{pid: pid} do
      Session.update(pid, fn s -> %{s | mode: :elixir_repl} end)
      assert "iex> " = Session.get_prompt(pid)
    end
  end

  describe "mode" do
    test "starts in normal mode", %{pid: pid} do
      assert :normal = Session.get_mode(pid)
    end
  end
end
