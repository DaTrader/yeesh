defmodule Yeesh.Markdown do
  @moduledoc """
  Converts Markdown to ANSI-escaped terminal output.

  Parses CommonMark Markdown via MDEx and produces strings with
  ANSI escape sequences that xterm.js renders natively.

  ## Supported Elements

  - Headings (h1: bold yellow, h2: bold cyan, h3+: bold white)
  - Bold, italic, strikethrough, inline code
  - Bullet lists (▸ markers) and ordered lists (circled numbers)
  - Code blocks with optional language headers
  - Block quotes (│ prefix)
  - Thematic breaks (horizontal rules)
  - Links (underlined blue with dimmed URL)
  - Task list items (checkbox markers)

  ## Example

      output = Yeesh.Markdown.render("# Hello\\n\\nSome **bold** text.")
  """

  # ANSI escape sequences
  @reset "\e[0m"
  @bold "\e[1m"
  @dim "\e[2m"
  @italic "\e[3m"
  @underline "\e[4m"
  @strikethrough "\e[9m"

  @green "\e[32m"
  @blue "\e[34m"

  # Combined styles for headings
  @h1 "\e[1;33m"
  @h2 "\e[1;36m"
  @h3 "\e[1;37m"

  @circled ~w(① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩ ⑪ ⑫ ⑬ ⑭ ⑮ ⑯ ⑰ ⑱ ⑲ ⑳)

  @doc """
  Renders a Markdown string as ANSI-escaped terminal output.

  Returns a string with embedded ANSI escape sequences and `\\r\\n`
  line endings suitable for xterm.js rendering.
  """
  @parse_opts [
    extension: [
      strikethrough: true,
      tasklist: true,
      table: true,
      autolink: true,
      shortcodes: true
    ]
  ]

  @spec render(String.t()) :: String.t()
  def render(markdown) when is_binary(markdown) do
    markdown
    |> MDEx.parse_document!(@parse_opts)
    |> render_document()
  end

  defp render_document(%MDEx.Document{nodes: nodes}) do
    nodes
    |> Enum.map(&render_block/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\r\n\r\n")
  end

  # ── Block-level nodes ──────────────────────────────────────────────

  defp render_block(%MDEx.Heading{level: 1, nodes: children}),
    do: @h1 <> render_inline(children) <> @reset

  defp render_block(%MDEx.Heading{level: 2, nodes: children}),
    do: @h2 <> render_inline(children) <> @reset

  defp render_block(%MDEx.Heading{level: _level, nodes: children}),
    do: @h3 <> render_inline(children) <> @reset

  defp render_block(%MDEx.Paragraph{nodes: children}),
    do: render_inline(children)

  defp render_block(%MDEx.List{list_type: :bullet, nodes: items}) do
    Enum.map_join(items, "\r\n", &render_bullet_item/1)
  end

  defp render_block(%MDEx.List{list_type: :ordered, nodes: items, start: start}) do
    items
    |> Enum.with_index(start || 1)
    |> Enum.map_join("\r\n", fn {item, idx} -> render_ordered_item(item, idx) end)
  end

  defp render_block(%MDEx.CodeBlock{literal: literal, info: info}) do
    code = String.trim_trailing(literal, "\n")
    lines = String.split(code, "\n")

    header =
      if is_binary(info) and info != "",
        do: @dim <> "  ┌─ " <> info <> @reset <> "\r\n",
        else: @dim <> "  ┌─" <> @reset <> "\r\n"

    body =
      Enum.map_join(lines, "\r\n", fn line ->
        @dim <> "  │ " <> @reset <> @green <> line <> @reset
      end)

    footer = "\r\n" <> @dim <> "  └─" <> @reset

    header <> body <> footer
  end

  defp render_block(%MDEx.BlockQuote{nodes: children}) do
    children
    |> Enum.map_join("\r\n", &render_block/1)
    |> String.split("\r\n")
    |> Enum.map_join("\r\n", fn line -> @dim <> "  │ " <> @reset <> line end)
  end

  defp render_block(%MDEx.ThematicBreak{}),
    do: @dim <> String.duplicate("─", 40) <> @reset

  defp render_block(%MDEx.HtmlBlock{literal: literal}),
    do: @dim <> String.trim_trailing(literal, "\n") <> @reset

  # Catch-all for unknown block nodes with children or literal
  defp render_block(%{nodes: children}) when is_list(children),
    do: Enum.map_join(children, "\r\n", &render_block/1)

  defp render_block(%{literal: literal}) when is_binary(literal), do: literal
  defp render_block(_node), do: ""

  # ── List items ─────────────────────────────────────────────────────

  defp render_bullet_item(%MDEx.TaskItem{checked: true, nodes: children}),
    do: "  ☑ " <> render_item_content(children)

  defp render_bullet_item(%MDEx.TaskItem{checked: false, nodes: children}),
    do: "  ☐ " <> render_item_content(children)

  defp render_bullet_item(%MDEx.ListItem{nodes: children}),
    do: "  ▸ " <> render_item_content(children)

  defp render_bullet_item(other), do: render_block(other)

  defp render_ordered_item(%MDEx.ListItem{nodes: children}, idx),
    do: "  " <> circled(idx) <> " " <> render_item_content(children)

  defp render_ordered_item(other, _idx), do: render_block(other)

  # Tight list items contain a single paragraph; loose items may contain several blocks.
  defp render_item_content([%MDEx.Paragraph{nodes: children}]),
    do: render_inline(children)

  defp render_item_content(nodes) do
    Enum.map_join(nodes, "\r\n    ", fn
      %MDEx.Paragraph{nodes: children} -> render_inline(children)
      block -> render_block(block)
    end)
  end

  # ── Inline nodes ───────────────────────────────────────────────────

  defp render_inline(nodes) when is_list(nodes),
    do: Enum.map_join(nodes, &render_inline_node/1)

  defp render_inline_node(%MDEx.Text{literal: text}), do: text

  defp render_inline_node(%MDEx.Strong{nodes: children}),
    do: @bold <> render_inline(children) <> @reset

  defp render_inline_node(%MDEx.Emph{nodes: children}),
    do: @italic <> render_inline(children) <> @reset

  defp render_inline_node(%MDEx.Strikethrough{nodes: children}),
    do: @strikethrough <> render_inline(children) <> @reset

  defp render_inline_node(%MDEx.Code{literal: text}),
    do: @green <> text <> @reset

  defp render_inline_node(%MDEx.Link{url: url, nodes: children}) do
    @underline <>
      @blue <>
      render_inline(children) <>
      @reset <>
      @dim <> " (" <> url <> ")" <> @reset
  end

  defp render_inline_node(%MDEx.Image{url: url, nodes: children}) do
    @dim <>
      "[image: " <>
      render_inline(children) <>
      "]" <>
      @reset <>
      @dim <> " (" <> url <> ")" <> @reset
  end

  defp render_inline_node(%MDEx.SoftBreak{}), do: " "
  defp render_inline_node(%MDEx.LineBreak{}), do: "\r\n"

  defp render_inline_node(%MDEx.HtmlInline{literal: literal}), do: literal

  defp render_inline_node(%MDEx.ShortCode{emoji: emoji}) when is_binary(emoji), do: emoji

  # Catch-all for unknown inline nodes
  defp render_inline_node(%{literal: literal}) when is_binary(literal), do: literal
  defp render_inline_node(%{nodes: children}) when is_list(children), do: render_inline(children)
  defp render_inline_node(_node), do: ""

  # ── Helpers ────────────────────────────────────────────────────────

  defp circled(n) when n >= 1 and n <= 20, do: Enum.at(@circled, n - 1)
  defp circled(n), do: "(#{n})"
end
