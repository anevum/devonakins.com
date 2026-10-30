export const projects = [
  {
    slug: "ideaflow",
    title: "IdeaFlow",
    category: "software",
    label: "Ideas & collaboration",
    status: "In development",
    icon: "flow",
    summary: "Give a good conversation somewhere to go.",
    description:
      "A workspace for capturing ideas and working through them together. The current development work brings conversation, presentation, and idea capture into one place.",
    detail:
      "The useful question is what happens after the meeting: which ideas matter, what needs clarification, and what is worth doing next. IdeaFlow is being developed around that handoff.",
    boundary:
      "The working application is private. This is a public overview; meeting rooms, recordings, and transcripts are not shared here.",
    tags: ["Collaboration", "Capture", "Software"],
    next: "Keep testing the core meeting and presentation experience before expanding it.",
  },
  {
    slug: "devonstation",
    title: "DevonStation",
    category: "software",
    label: "Personal systems",
    status: "Private · in development",
    icon: "station",
    summary: "A home base for work, thinking, and making.",
    description:
      "My private operating workspace for keeping projects, ideas, and the next practical step in view.",
    detail:
      "The problem is not a shortage of ideas. It is remembering what has already been decided, seeing what is actually ready, and getting back to the work without starting over. DevonStation explores that problem with a personal workspace.",
    boundary:
      "DevonStation is an owner-only application. Its interface, records, infrastructure, and access links stay private.",
    tags: ["Personal tools", "Continuity", "Systems"],
    next: "Improve reliability and the daily workflow before adding more moving parts.",
  },
  {
    slug: "anevum",
    title: "ANEVUM",
    category: "creative",
    label: "Worlds & interactive work",
    status: "Ongoing creative project",
    icon: "anevum",
    summary: "Stories, strange places, and worlds worth exploring.",
    description:
      "An independent family creative project for fictional worlds, stories, games, and experiments in interactive storytelling.",
    detail:
      "ANEVUM is a place to explore how a world feels, how its rules fit together, and what it is like to be inside it. The writing and the interactive work inform each other. It is an ongoing creative practice, with its own home at anevum.com.",
    boundary:
      "Only released public material belongs in this showcase. Unpublished manuscripts, private canon, and family information remain private.",
    tags: ["Fiction", "Worldbuilding", "Games"],
    url: "https://anevum.com",
    next: "Finish small, playable and readable pieces of the larger world.",
  },
  {
    slug: "field-instruments",
    title: "Field instruments",
    category: "experiments",
    label: "Interactive experiments",
    status: "Explore here",
    icon: "orbit",
    summary: "Change one thing. See what happens.",
    description:
      "Small browser experiments in waves, orbital motion, and better questions. Built to make an idea tangible.",
    detail:
      "These are deliberately small models. Move a control, observe the response, and ask what the model leaves out. The wave instrument demonstrates superposition; the orbital sketch demonstrates how eccentricity changes a path.",
    boundary:
      "These experiments run in your browser. They do not collect input, call an AI service, or claim to simulate a complete physical system.",
    tags: ["Waves", "Geometry", "Learning"],
    url: "/lab/",
    next: "Keep each experiment focused on one clear question.",
  },
];
export const notes = [
  {
    slug: "start-with-what-exists",
    category: "Making",
    title: "Start with what exists.",
    excerpt: "The first useful step is often a closer look.",
    body: [
      "Before I build a new system, I want to understand the one that is already there. What works? Where does it break? Which part is actually asking to change?",
      "A fresh start can feel like progress because everything is possible again. But it also throws away the knowledge stored in an awkward prototype, an old decision, or a workaround that exists for a reason.",
      "I try to make the next change small enough to inspect. Keep the useful parts. State the problem plainly. Change one thing that matters, then check whether it helped.",
      "The point is to make something useful and understand it well enough to keep improving it.",
    ],
  },
  {
    slug: "a-model-is-a-question",
    category: "Learning",
    title: "A model is a question you can move.",
    excerpt: "What changing a simple wave can teach us about a bigger system.",
    body: [
      "A wave on a screen is not the ocean. It is a deliberately incomplete description of motion. That limitation is useful when it lets us isolate something we want to understand.",
      "Take two waves. At each point, add their displacements. Sometimes they reinforce each other. Sometimes they cancel. Change the phase and the pattern changes, even though the individual waves are still there.",
      "The wave instrument in the Lab is built around that one relationship. It uses a sine wave and a second harmonic. Their sum is plotted directly, without a claim that the drawing is a full physical simulation.",
      "A useful model makes its assumptions visible. It gives you a way to test an intuition, and a reason to ask what you left out.",
    ],
  },
  {
    slug: "leave-a-trail",
    category: "Process",
    title: "Leave a trail back to the work.",
    excerpt: "A good note makes it easier to begin again tomorrow.",
    body: [
      "A project is easier to return to when its last decision is easy to find. I do not need a perfect history of everything I tried. I need to know what is true now.",
      "A useful checkpoint says what changed, what was checked, what remains uncertain, and which small action comes next. It separates a finished piece from an interesting possibility.",
      "That is also why an experiment needs an honest label. A sketch can be valuable as a sketch. Calling it finished makes it harder to see what still needs work.",
      "I want the things I make to carry enough context that I can stop, be present elsewhere, and return without rebuilding the whole project in my head.",
    ],
  },
];
export const pages = [
  {
    path: "/",
    key: "home",
    title: "Devon Akins — I build things to understand them.",
    description:
      "Software, useful systems, fictional worlds, and experiments. A personal workshop by Devon Akins.",
  },
  {
    path: "/work/",
    key: "work",
    title: "Work — Devon Akins",
    description:
      "Honest project notes on IdeaFlow, DevonStation, ANEVUM, and browser experiments.",
  },
  {
    path: "/lab/",
    key: "lab",
    title: "The Lab — Devon Akins",
    description:
      "Explore wave superposition, orbital geometry, and useful questions in a hands-on browser Lab.",
  },
  {
    path: "/source/",
    key: "source",
    title: "Open source — Devon Akins",
    description:
      "Public source, contribution information, and the boundary between open code and private data.",
  },
  {
    path: "/notes/",
    key: "notes",
    title: "Notes — Devon Akins",
    description:
      "Short notes on making things, learning through models, and keeping useful continuity.",
  },
  {
    path: "/about/",
    key: "about",
    title: "About — Devon Akins",
    description:
      "A little about how I think, what I make, and why I keep asking questions.",
  },
  {
    path: "/contact/",
    key: "contact",
    title: "Contact — Devon Akins",
    description: "A direct way to get in touch with Devon Akins.",
  },
];
