/**
 * YeeshTerminal - LiveView hook wrapping xterm.js
 *
 * Provides a full terminal experience in the browser with:
 * - Local line editing (cursor, backspace, delete, home/end)
 * - Command submission on Enter
 * - Tab completion
 * - History navigation (up/down arrows, Ctrl+P/N, Shift+Ctrl+P/N)
 * - Reverse incremental search (Ctrl+R)
 * - Clipboard: Shift+Ctrl+C (copy), Shift+Ctrl+V (paste), Shift+Ctrl+X (cut)
 * - Ctrl+C (interrupt), Ctrl+L (clear)
 *
 * Communicates with Yeesh.Live.TerminalComponent via pushEvent/handleEvent.
 */

import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

const THEMES = {
  default: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    selectionBackground: "#585b70",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  light: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    cursor: "#dc8a78",
    selectionBackground: "#acb0be",
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#ea76cb",
    cyan: "#179299",
    white: "#bcc0cc",
  },
};

const YeeshTerminal = {
  mounted() {
    this.inputBuffer = "";
    this.cursorPos = 0;
    this.prompt = this.el.dataset.prompt || "$ ";
    this.knownCommands = JSON.parse(this.el.dataset.commands || "[]");

    // Reverse-i-search state
    this.searchMode = false;
    this.searchQuery = "";
    this.searchSkip = 0;
    this.searchMatch = "";
    this.savedInputBuffer = "";
    this.savedCursorPos = 0;

    // Prefix-filtered history navigation (fish-style)
    this.historyPrefix = null;

    const themeName = this.el.dataset.theme || "default";
    const theme = THEMES[themeName] || THEMES.default;

    this.term = new Terminal({
      theme,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());

    this.term.open(this.el);
    this.fitAddon.fit();

    // Welcome message
    this.term.writeln(
      "\x1b[1;36mYeesh\x1b[0m - sandboxed terminal (type \x1b[1mhelp\x1b[0m for commands)"
    );
    this.writePrompt();

    // Intercept keys before xterm processes them.
    // Handles arrow history navigation, Ctrl+R search, and Ctrl+P/N.
    this.term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      // --- Shift+Ctrl+C / V / X: clipboard operations ---
      if (event.ctrlKey && event.shiftKey) {
        if (event.key === "C") {
          event.preventDefault();
          const sel = this.term.getSelection();
          if (sel) {
            navigator.clipboard.writeText(sel);
            this.term.clearSelection();
          }
          return false;
        }
        if (event.key === "V") {
          event.preventDefault();
          navigator.clipboard.readText().then((text) => this.pasteText(text));
          return false;
        }
        if (event.key === "X") {
          event.preventDefault();
          const sel = this.term.getSelection();
          if (sel) {
            navigator.clipboard.writeText(sel);
            this.term.clearSelection();
          }
          return false;
        }
        // Shift+Ctrl+P / N: history prev/next (browser-safe alternative)
        if (event.key === "P") {
          event.preventDefault();
          if (this.searchMode) this.exitSearchMode(true);
          if (this.historyPrefix === null)
            this.historyPrefix = this.inputBuffer;
          this.pushEventTo(this.el, "yeesh:history_prev", {
            prefix: this.historyPrefix,
          });
          return false;
        }
        if (event.key === "N") {
          event.preventDefault();
          if (this.searchMode) this.exitSearchMode(true);
          if (this.historyPrefix === null)
            this.historyPrefix = this.inputBuffer;
          this.pushEventTo(this.el, "yeesh:history_next", {
            prefix: this.historyPrefix,
          });
          return false;
        }
      }

      // --- Ctrl+R: enter or cycle reverse-i-search ---
      if (event.ctrlKey && event.key === "r") {
        event.preventDefault();
        if (!this.searchMode) {
          this.enterSearchMode();
        } else {
          this.searchSkip++;
          this.pushEventTo(this.el, "yeesh:history_search", {
            query: this.searchQuery,
            skip: this.searchSkip,
          });
        }
        return false;
      }

      // --- Ctrl+P / Ctrl+N: history prev/next (also exits search) ---
      if (event.ctrlKey && event.key === "p") {
        event.preventDefault();
        if (this.searchMode) this.exitSearchMode(true);
        if (this.historyPrefix === null) this.historyPrefix = this.inputBuffer;
        this.pushEventTo(this.el, "yeesh:history_prev", {
          prefix: this.historyPrefix,
        });
        return false;
      }
      if (event.ctrlKey && event.key === "n") {
        event.preventDefault();
        if (this.searchMode) this.exitSearchMode(true);
        if (this.historyPrefix === null) this.historyPrefix = this.inputBuffer;
        this.pushEventTo(this.el, "yeesh:history_next", {
          prefix: this.historyPrefix,
        });
        return false;
      }

      // --- When in search mode, consume all keys here ---
      if (this.searchMode) {
        event.preventDefault();

        // Escape / Ctrl+G: cancel search, restore original input
        if (event.key === "Escape" || (event.ctrlKey && event.key === "g")) {
          this.exitSearchMode(false);
          return false;
        }

        // Enter: accept match and execute
        if (event.key === "Enter") {
          this.exitSearchMode(true);
          this.term.writeln("");
          const input = this.inputBuffer;
          this.inputBuffer = "";
          this.cursorPos = 0;
          this.historyPrefix = null;
          if (input.trim().length > 0) {
            this.pushEventTo(this.el, "yeesh:input", { input });
          } else {
            this.writePrompt();
          }
          return false;
        }

        // Tab / ArrowRight / ArrowLeft: accept match, stay on line
        if (
          event.key === "Tab" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowLeft"
        ) {
          this.exitSearchMode(true);
          return false;
        }

        // Ctrl+C: cancel search + interrupt
        if (event.ctrlKey && event.key === "c") {
          this.exitSearchMode(false);
          this.term.write("^C\r\n");
          this.inputBuffer = "";
          this.cursorPos = 0;
          this.historyPrefix = null;
          this.pushEventTo(this.el, "yeesh:interrupt", {});
          this.writePrompt();
          return false;
        }

        // Backspace: shorten query
        if (event.key === "Backspace") {
          if (this.searchQuery.length > 0) {
            this.searchQuery = this.searchQuery.slice(0, -1);
            this.searchSkip = 0;
            if (this.searchQuery.length > 0) {
              this.pushEventTo(this.el, "yeesh:history_search", {
                query: this.searchQuery,
                skip: 0,
              });
            } else {
              this.searchMatch = "";
              this.renderSearchLine();
            }
          } else {
            // Empty query + backspace exits search
            this.exitSearchMode(false);
          }
          return false;
        }

        // Printable character: append to search query
        if (
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          event.key.length === 1
        ) {
          this.searchQuery += event.key;
          this.searchSkip = 0;
          this.pushEventTo(this.el, "yeesh:history_search", {
            query: this.searchQuery,
            skip: 0,
          });
          return false;
        }

        // Consume everything else while in search mode
        return false;
      }

      // --- Normal mode: arrow key history navigation ---
      if (event.key === "ArrowUp") {
        if (this.historyPrefix === null) this.historyPrefix = this.inputBuffer;
        this.pushEventTo(this.el, "yeesh:history_prev", {
          prefix: this.historyPrefix,
        });
        return false;
      }
      if (event.key === "ArrowDown") {
        if (this.historyPrefix === null) this.historyPrefix = this.inputBuffer;
        this.pushEventTo(this.el, "yeesh:history_next", {
          prefix: this.historyPrefix,
        });
        return false;
      }

      return true;
    });

    // Key handling
    this.term.onKey(({ key, domEvent }) => {
      this.handleKey(key, domEvent);
    });

    // Resize
    this.resizeObserver = new ResizeObserver(() => {
      this.fitAddon.fit();
    });
    this.resizeObserver.observe(this.el);

    // Server events
    this.handleEvent("yeesh:output", ({ output }) => {
      if (output && output.length > 0) {
        // Convert \n to \r\n for xterm
        const formatted = output.replace(/(?<!\r)\n/g, "\r\n");
        this.term.writeln(formatted);
      }
      this.writePrompt();
    });

    this.handleEvent("yeesh:prompt", ({ prompt }) => {
      this.prompt = prompt;
    });

    this.handleEvent("yeesh:completion", ({ matches, replacement }) => {
      if (matches.length > 1) {
        // Show all matches
        this.term.writeln("");
        this.term.writeln(matches.join("  "));
        this.writePrompt();
        this.inputBuffer = replacement;
        this.cursorPos = replacement.length;
        this.term.write(replacement);
      } else {
        // Single match or common prefix - replace input
        this.clearInput();
        this.inputBuffer = replacement;
        this.cursorPos = replacement.length;
        this.term.write(replacement);
      }
    });

    this.handleEvent("yeesh:history", ({ entry }) => {
      this.clearInput();
      if (entry === "" && this.historyPrefix !== null) {
        // Navigated past newest match: restore original typed input
        const restored = this.historyPrefix;
        this.historyPrefix = null;
        this.inputBuffer = restored;
        this.cursorPos = restored.length;
        this.term.write(restored);
      } else {
        this.inputBuffer = entry;
        this.cursorPos = entry.length;
        this.term.write(entry);
      }
    });

    this.handleEvent("yeesh:search_result", ({ entry, found }) => {
      if (this.searchMode) {
        this.searchMatch = found ? entry : "";
        this.renderSearchLine();
      }
    });
  },

  destroyed() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.term) {
      this.term.dispose();
    }
  },

  handleKey(key, domEvent) {
    const ev = domEvent;
    const printable =
      !ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.key.length === 1;

    // Any input-modifying key resets prefix-filtered history navigation
    const resetsPrefix =
      printable ||
      ev.key === "Enter" ||
      ev.key === "Backspace" ||
      ev.key === "Delete" ||
      (ev.ctrlKey && ev.key === "c");
    if (resetsPrefix) {
      this.historyPrefix = null;
    }

    // Ctrl+C - interrupt
    if (ev.ctrlKey && ev.key === "c") {
      this.term.write("^C\r\n");
      this.inputBuffer = "";
      this.cursorPos = 0;
      this.pushEventTo(this.el, "yeesh:interrupt", {});
      this.writePrompt();
      return;
    }

    // Ctrl+L - clear screen (preserves current line)
    if (ev.ctrlKey && ev.key === "l") {
      this.term.clear();
      return;
    }

    // Enter - submit
    if (ev.key === "Enter") {
      this.term.writeln("");
      const input = this.inputBuffer;
      this.inputBuffer = "";
      this.cursorPos = 0;

      if (input.trim().length > 0) {
        this.pushEventTo(this.el, "yeesh:input", { input });
      } else {
        this.writePrompt();
      }
      return;
    }

    // Tab - completion
    if (ev.key === "Tab") {
      ev.preventDefault();
      this.pushEventTo(this.el, "yeesh:complete", {
        input: this.inputBuffer,
        cursor: this.cursorPos,
      });
      return;
    }

    // Backspace
    if (ev.key === "Backspace") {
      if (this.cursorPos > 0) {
        const before = this.inputBuffer.slice(0, this.cursorPos - 1);
        const after = this.inputBuffer.slice(this.cursorPos);
        this.inputBuffer = before + after;
        this.cursorPos--;
        // Move cursor back, rewrite rest, clear trailing char
        this.term.write(
          "\b" + after + " " + "\b".repeat(after.length + 1)
        );
      }
      return;
    }

    // Delete
    if (ev.key === "Delete") {
      if (this.cursorPos < this.inputBuffer.length) {
        const before = this.inputBuffer.slice(0, this.cursorPos);
        const after = this.inputBuffer.slice(this.cursorPos + 1);
        this.inputBuffer = before + after;
        this.term.write(after + " " + "\b".repeat(after.length + 1));
      }
      return;
    }

    // Arrow Up/Down are handled by attachCustomKeyEventHandler above
    // to ensure reliable interception across xterm.js versions.

    // Arrow Left
    if (ev.key === "ArrowLeft") {
      if (this.cursorPos > 0) {
        this.cursorPos--;
        this.term.write(key);
      }
      return;
    }

    // Arrow Right
    if (ev.key === "ArrowRight") {
      if (this.cursorPos < this.inputBuffer.length) {
        this.cursorPos++;
        this.term.write(key);
      }
      return;
    }

    // Home
    if (ev.key === "Home") {
      if (this.cursorPos > 0) {
        this.term.write("\x1b[" + this.cursorPos + "D");
        this.cursorPos = 0;
      }
      return;
    }

    // End
    if (ev.key === "End") {
      const remaining = this.inputBuffer.length - this.cursorPos;
      if (remaining > 0) {
        this.term.write("\x1b[" + remaining + "C");
        this.cursorPos = this.inputBuffer.length;
      }
      return;
    }

    // Printable character
    if (printable) {
      const before = this.inputBuffer.slice(0, this.cursorPos);
      const after = this.inputBuffer.slice(this.cursorPos);
      this.inputBuffer = before + ev.key + after;
      this.cursorPos++;

      if (after.length > 0) {
        // Insert mode: write char + rest, then move cursor back
        this.term.write(ev.key + after + "\b".repeat(after.length));
      } else {
        this.term.write(ev.key);
      }
    }
  },

  writePrompt() {
    this.term.write(this.prompt);
  },

  clearInput() {
    // Move to start of input, then clear to end of line
    if (this.cursorPos > 0) {
      this.term.write("\b".repeat(this.cursorPos));
    }
    this.term.write("\x1b[K");
    this.inputBuffer = "";
    this.cursorPos = 0;
  },

  enterSearchMode() {
    this.searchMode = true;
    this.searchQuery = "";
    this.searchSkip = 0;
    this.searchMatch = "";
    this.savedInputBuffer = this.inputBuffer;
    this.savedCursorPos = this.cursorPos;
    this.renderSearchLine();
  },

  exitSearchMode(accept) {
    this.searchMode = false;
    // Clear entire line
    this.term.write("\r\x1b[K");

    if (accept && this.searchMatch) {
      this.inputBuffer = this.searchMatch;
      this.cursorPos = this.searchMatch.length;
    } else {
      this.inputBuffer = this.savedInputBuffer;
      this.cursorPos = this.savedCursorPos;
    }

    this.writePrompt();
    this.term.write(this.inputBuffer);
    // Reposition cursor if not at end
    const trail = this.inputBuffer.length - this.cursorPos;
    if (trail > 0) {
      this.term.write("\x1b[" + trail + "D");
    }
  },

  renderSearchLine() {
    this.term.write("\r\x1b[K");
    const label = "(reverse-i-search)'" + this.searchQuery + "': ";
    this.term.write(label + this.searchMatch);

    // Keep inputBuffer in sync so Enter can submit immediately
    if (this.searchMatch) {
      this.inputBuffer = this.searchMatch;
      this.cursorPos = this.searchMatch.length;
    }
  },

  /**
   * Insert text at the current cursor position (used by paste).
   * Newlines are collapsed to spaces; control characters are stripped.
   */
  pasteText(text) {
    if (!text) return;

    if (this.searchMode) {
      this.searchQuery += text.replace(/[\r\n]+/g, " ").replace(/[\x00-\x1f\x7f]/g, "");
      this.searchSkip = 0;
      if (this.searchQuery.length > 0) {
        this.pushEventTo(this.el, "yeesh:history_search", {
          query: this.searchQuery,
          skip: 0,
        });
      } else {
        this.searchMatch = "";
        this.renderSearchLine();
      }
      return;
    }

    const sanitized = text
      .replace(/[\r\n]+/g, " ")
      .replace(/[\x00-\x1f\x7f]/g, "");
    if (!sanitized) return;

    const before = this.inputBuffer.slice(0, this.cursorPos);
    const after = this.inputBuffer.slice(this.cursorPos);
    this.inputBuffer = before + sanitized + after;
    this.cursorPos += sanitized.length;
    this.historyPrefix = null;

    if (after.length > 0) {
      this.term.write(sanitized + after + "\b".repeat(after.length));
    } else {
      this.term.write(sanitized);
    }
  },
};

export { YeeshTerminal };
export default YeeshTerminal;
