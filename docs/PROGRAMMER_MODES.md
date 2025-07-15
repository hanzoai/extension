# Legendary Programmer Modes

The Hanzo extension includes 45+ development modes inspired by legendary programmers and their philosophies. Each mode configures tools and settings to match their development style.

## Usage

```
@hanzo mode list                    # List all available modes
@hanzo mode activate guido          # Activate Python creator mode
@hanzo mode show ritchie            # Show details about C creator mode
@hanzo mode current                 # Show current active mode
```

## Language Creators (19 modes)

### System Languages
- **ritchie** - Dennis Ritchie (C) - *"UNIX: Do one thing and do it well"*
- **bjarne** - Bjarne Stroustrup (C++) - *"C++: Light-weight abstraction"*
- **gosling** - James Gosling (Java) - *"Java: Platform independence"*
- **graydon** - Graydon Hoare (Rust) - *"Fast, reliable, productive — pick three"*
- **pike_thompson** - Rob Pike & Ken Thompson (Go) - *"Less is exponentially more"*

### Dynamic Languages
- **guido** - Guido van Rossum (Python) - *"There should be one-- and preferably only one --obvious way to do it"*
- **matz** - Yukihiro Matsumoto (Ruby) - *"Ruby is designed to make programmers happy"*
- **wall** - Larry Wall (Perl) - *"There's More Than One Way To Do It"*
- **rasmus** - Rasmus Lerdorf (PHP) - *"PHP: Solving web problems pragmatically"*
- **brendan** - Brendan Eich (JavaScript) - *"Always bet on JavaScript"*

### Functional Languages
- **mccarthy** - John McCarthy (Lisp) - *"Lisp: The programmable programming language"*
- **hickey** - Rich Hickey (Clojure) - *"Simple Made Easy"*
- **armstrong** - Joe Armstrong (Erlang) - *"Let it crash and recover"*
- **odersky** - Martin Odersky (Scala) - *"Fusion of functional and object-oriented programming"*

### Modern Languages
- **anders** - Anders Hejlsberg (C#/TypeScript) - *"Pragmatism over dogmatism"*
- **lattner** - Chris Lattner (Swift/LLVM) - *"Performance and safety without compromise"*
- **bak** - Lars Bak (Dart/V8) - *"Fast development and execution"*

### Classic Languages
- **wirth** - Niklaus Wirth (Pascal) - *"Algorithms + Data Structures = Programs"*
- **backus** - John Backus (Fortran) - *"Formula Translation for scientists"*
- **hopper** - Grace Hopper (COBOL) - *"Programming for everyone"*
- **kay** - Alan Kay (Smalltalk) - *"The best way to predict the future is to invent it"*

## Systems & Infrastructure (2 modes)

- **linus** - Linus Torvalds (Linux) - *"Talk is cheap. Show me the code."*
- **ritchie_thompson** - Ritchie & Thompson (UNIX) - *"Keep it simple, stupid"*

## Web Frameworks (7 modes)

### Backend Frameworks
- **dhh** - David Heinemeier Hansson (Rails) - *"Optimize for programmer happiness"*
- **holovaty_willison** - Holovaty & Willison (Django) - *"The web framework for perfectionists with deadlines"*
- **ronacher** - Armin Ronacher (Flask) - *"Web development, one drop at a time"*
- **otwell** - Taylor Otwell (Laravel) - *"The PHP framework for web artisans"*
- **holowaychuk** - TJ Holowaychuk (Express.js) - *"Fast, unopinionated, minimalist"*

### Frontend Frameworks
- **evan** - Evan You (Vue.js) - *"Approachable, versatile, performant"*
- **walke** - Jordan Walke (React) - *"UI as a function of state"*

## JavaScript Ecosystem (3 modes)

- **katz** - Yehuda Katz (Ember.js) - *"Convention over Configuration"*
- **ashkenas** - Jeremy Ashkenas (CoffeeScript) - *"It's just JavaScript"*
- **nolen** - David Nolen (ClojureScript) - *"Functional programming for the web"*

## Database & Infrastructure (1 mode)

- **widenius** - Michael Widenius (MySQL/MariaDB) - *"Open source database for everyone"*

## CSS & Design (2 modes)

- **wathan** - Adam Wathan (Tailwind CSS) - *"Stop writing CSS, start building designs"*
- **otto_thornton** - Otto & Thornton (Bootstrap) - *"Build responsive, mobile-first projects"*

## Special Configurations (6 modes)

- **fullstack** - Full Stack Developer - Frontend to backend, databases to deployment
- **minimal** - Minimalist - Less is more, only essential tools
- **10x** - 10x Engineer - Maximum productivity, all tools enabled
- **security** - Security Engineer - Security first, paranoid by design
- **data_scientist** - Data Scientist - Data analysis and ML focused
- **hanzo** - Hanzo AI - Optimal configuration with all advanced features

## Mode Features

Each mode configures:

1. **Tools**: Specific set of enabled tools matching the programmer's workflow
2. **Philosophy**: The guiding principle of that programmer/language
3. **Config Scores**: Personality traits scored 0-10 (e.g., simplicity, performance, readability)

## Examples

### Python Development (Guido mode)
```
@hanzo mode activate guido
# Enables: read, write, edit, grep, symbols, uvx, think, notebook_read, notebook_edit
# Philosophy: "There should be one-- and preferably only one --obvious way to do it"
# Config: readability: 10, simplicity: 9, explicitness: 10
```

### Systems Programming (Linus mode)
```
@hanzo mode activate linus
# Enables: read, write, edit, grep, git_search, bash, processes, critic
# Philosophy: "Talk is cheap. Show me the code."
# Config: performance: 10, directness: 10, patience: 2
```

### Web Development (DHH mode)
```
@hanzo mode activate dhh
# Enables: read, write, edit, multi_edit, grep, bash, run_command, sql_query
# Philosophy: "Optimize for programmer happiness"
# Config: productivity: 10, conventions: 10, opinionated: 10
```

### Maximum Productivity (10x mode)
```
@hanzo mode activate 10x
# Enables: ALL advanced tools including agent, llm, consensus, think, critic
# Config: productivity: 10, tool_mastery: 10, work_life_balance: 3
```

## Mode Selection Guide

- **Learning a language**: Choose its creator's mode (e.g., `guido` for Python)
- **Building web apps**: Choose framework creator (e.g., `dhh` for Rails, `evan` for Vue)
- **System programming**: Choose `ritchie`, `linus`, or `graydon`
- **Maximum features**: Choose `10x` or `hanzo`
- **Focused work**: Choose `minimal`
- **Security audit**: Choose `security`

Each mode embodies the philosophy and approach of its namesake, helping you code in their style!