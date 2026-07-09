const stickyCta = document.querySelector("[data-sticky-cta]");
const tour = document.querySelector("[data-tour]");
const tourTabs = Array.from(document.querySelectorAll("[data-tour-tab]"));
const tourCards = Array.from(document.querySelectorAll("[data-tour-card]"));
const formStatus = document.querySelector("[data-form-status]");
const flowSection = document.querySelector("[data-flow-section]");
const flowStage = document.querySelector("[data-flow-stage]");
const flowPills = Array.from(document.querySelectorAll("[data-flow-pill]"));
const whyShowcase = document.querySelector("[data-why-showcase]");
const featureGrid = document.querySelector(".feature-grid");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const compactTour = window.matchMedia("(max-width: 940px)");
let scrollFrame = null;
let activeTourStep = 0;
let tourInterval = null;
let tourIsVisible = false;
let tourIsPaused = false;
const tourIntervalDelay = 5000;

const tourSteps = [
  {
    step: "Step 01",
    title: "Capture solar enquiry",
    heading: "Every enquiry lands with the details your team needs.",
    copy: "Track lead source, system requirement, address, follow-up date, owner, and next action from one mobile-first view.",
    rows: [
      ["Customer", "Mehta Residence"],
      ["Requirement", "10kW rooftop"],
      ["Next action", "Assign survey"],
    ],
  },
  {
    step: "Step 02",
    title: "Schedule site survey",
    heading: "Field teams know which sites need attention.",
    copy: "Assign survey owners, update visit status, and keep site notes connected to the lead before quotation starts.",
    rows: [
      ["Survey owner", "Amit Sharma"],
      ["Visit window", "Tomorrow, 11:00 AM"],
      ["Status", "Scheduled"],
    ],
  },
  {
    step: "Step 03",
    title: "Create solar quotation",
    heading: "Build proposals around system size and product data.",
    copy: "Organize panels, inverter, structure, installation cost, taxes, discounts, and final quote value in one place.",
    rows: [
      ["System size", "10kW"],
      ["Products", "Panels + inverter"],
      ["Quote value", "₹6.85L"],
    ],
  },
  {
    step: "Step 04",
    title: "Start project execution",
    heading: "Approved work moves into a clear project track.",
    copy: "Carry customer and quotation details forward, then track material assignment, installation dates, and handover progress.",
    rows: [
      ["Project stage", "Material assigned"],
      ["Installation", "Scheduled"],
      ["Handover", "Pending"],
    ],
  },
  {
    step: "Step 05",
    title: "Manage payment and invoice",
    heading: "Payment status stays visible from approval to invoice.",
    copy: "See collected, pending, overdue, and invoiced amounts so sales, accounts, and project teams stay aligned.",
    rows: [
      ["Advance collected", "₹2.05L"],
      ["Balance due", "₹4.80L"],
      ["Invoice", "Pending"],
    ],
  },
];

function updateChrome() {
  const pastHero = window.scrollY > 220;
  stickyCta?.classList.toggle("visible", pastHero);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function getFlowTargets(stageWidth) {
  if (stageWidth < 620) {
    const spread = Math.min(118, Math.max(92, stageWidth * 0.31));

    return [
      { x: -spread * 0.1, y: -164, rotation: -7 },
      { x: -spread * 0.52, y: -108, rotation: 8 },
      { x: spread * 0.5, y: -116, rotation: -6 },
      { x: -spread * 0.94, y: -54, rotation: -9 },
      { x: -spread * 0.15, y: -66, rotation: 5 },
      { x: spread * 0.88, y: -50, rotation: 9 },
      { x: -spread, y: -10, rotation: 7 },
      { x: spread * 0.42, y: -78, rotation: -8 },
      { x: spread * 0.98, y: -6, rotation: 6 },
    ];
  }

  const spread = Math.min(260, Math.max(190, stageWidth * 0.22));

  return [
    { x: -spread * 0.06, y: -156, rotation: -6 },
    { x: -spread * 0.48, y: -104, rotation: 7 },
    { x: spread * 0.46, y: -114, rotation: -8 },
    { x: -spread * 0.86, y: -52, rotation: -9 },
    { x: -spread * 0.14, y: -66, rotation: 5 },
    { x: spread * 0.8, y: -46, rotation: 9 },
    { x: -spread * 1.04, y: -8, rotation: 6 },
    { x: spread * 0.5, y: -82, rotation: -7 },
    { x: spread * 1.02, y: -4, rotation: 6 },
  ];
}

function updateFlowAnimation() {
  if (!flowSection || !flowStage || flowPills.length === 0) {
    return;
  }

  const sectionRect = flowSection.getBoundingClientRect();
  const stageRect = flowStage.getBoundingClientRect();
  const travel = Math.max(flowSection.offsetHeight - window.innerHeight, 1);
  const progress = reducedMotion.matches ? 1 : clamp(-sectionRect.top / travel, 0, 1);
  const startY = -90 - (stageRect.top + stageRect.height / 2);
  const targets = getFlowTargets(stageRect.width);
  const compactFlow = stageRect.width < 620;
  const dropStagger = compactFlow ? 0.018 : 0.045;
  const dropDuration = compactFlow ? 0.12 : 0.18;

  flowPills.forEach((pill, index) => {
    const target = targets[index] || targets[targets.length - 1];
    const localProgress = clamp((progress - index * dropStagger) / dropDuration, 0, 1);
    const eased = easeOutCubic(localProgress);
    const bounce = localProgress > 0.72 && localProgress < 1
      ? Math.sin(((localProgress - 0.72) / 0.28) * Math.PI) * 20
      : 0;
    const y = startY + (target.y - startY) * eased + bounce;
    const startRotation = index % 2 === 0 ? -18 : 18;
    const rotation = startRotation * (1 - eased) + target.rotation * eased;

    pill.style.setProperty("--flow-x", `${target.x}px`);
    pill.style.setProperty("--flow-y", `${y}px`);
    pill.style.setProperty("--flow-rotate", `${rotation}deg`);
    pill.style.setProperty("--flow-scale", String(0.92 + eased * 0.08));
    pill.style.setProperty("--flow-opacity", String(clamp(localProgress * 1.7, 0, 1)));
    pill.style.zIndex = String(4 + index);
  });
}

function initWhyShowcase() {
  if (!whyShowcase) {
    return;
  }

  const revealWhyShowcase = () => whyShowcase.classList.add("is-visible");
  whyShowcase.classList.add("is-ready");

  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    revealWhyShowcase();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) {
      return;
    }

    revealWhyShowcase();
    observer.disconnect();
  }, { threshold: 0.32 });

  observer.observe(whyShowcase);
}

function initFeatureReveal() {
  if (!featureGrid) {
    return;
  }

  const revealFeatures = () => featureGrid.classList.add("is-visible");
  featureGrid.classList.add("is-reveal-ready");

  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    revealFeatures();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) {
      return;
    }

    revealFeatures();
    observer.disconnect();
  }, { threshold: 0.16 });

  observer.observe(featureGrid);
}

function requestScrollFrame() {
  if (scrollFrame !== null) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = null;
    updateChrome();
    updateFlowAnimation();
  });
}

function setTourStep(index) {
  activeTourStep = index;

  tourTabs.forEach((tab, tabIndex) => {
    const active = tabIndex === index;
    tab.setAttribute("aria-expanded", String(active));
    tourCards[tabIndex].classList.toggle("active", active);
  });
}

function stopTourAutoplay() {
  window.clearInterval(tourInterval);
  tourInterval = null;
  tour.classList.remove("is-autoplaying");
}

function startTourAutoplay() {
  stopTourAutoplay();

  if (!tourIsVisible || tourIsPaused || reducedMotion.matches) {
    return;
  }

  void tour.offsetWidth;
  tour.classList.add("is-autoplaying");
  tourInterval = window.setInterval(() => {
    setTourStep((activeTourStep + 1) % tourCards.length);
  }, tourIntervalDelay);
}

function setTourPaused(paused) {
  tourIsPaused = paused;
  tour.classList.toggle("is-paused", paused);
  startTourAutoplay();
}

tourTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {
    setTourStep(index);
    startTourAutoplay();
  });

  tab.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const previous = event.key === "ArrowUp" || event.key === "ArrowLeft";
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tourTabs.length - 1
        : (index + (previous ? -1 : 1) + tourTabs.length) % tourTabs.length;

    setTourStep(nextIndex);
    tourTabs[nextIndex].focus();
  });
});

tour.addEventListener("mouseenter", () => {
  if (!compactTour.matches) {
    setTourPaused(true);
  }
});
tour.addEventListener("mouseleave", () => {
  if (!compactTour.matches) {
    setTourPaused(false);
  }
});
tour.addEventListener("focusin", () => {
  if (!compactTour.matches) {
    setTourPaused(true);
  }
});
tour.addEventListener("focusout", (event) => {
  if (!compactTour.matches && !tour.contains(event.relatedTarget)) {
    setTourPaused(false);
  }
});

if ("IntersectionObserver" in window) {
  const tourObserver = new IntersectionObserver(([entry]) => {
    tourIsVisible = entry.isIntersecting;
    startTourAutoplay();
  }, { threshold: 0.35 });

  tourObserver.observe(tour);
} else {
  tourIsVisible = true;
  startTourAutoplay();
}

document.querySelector(".pricing-form").addEventListener("submit", (event) => {
  event.preventDefault();
  event.currentTarget.reset();
  formStatus.textContent = "Thanks. Your pricing request is ready for the Bizlee team workflow.";
  formStatus.classList.add("visible");
});

window.addEventListener("scroll", requestScrollFrame, { passive: true });
window.addEventListener("resize", requestScrollFrame);
reducedMotion.addEventListener("change", () => {
  requestScrollFrame();
  startTourAutoplay();
});
compactTour.addEventListener("change", () => {
  if (compactTour.matches) {
    setTourPaused(false);
  } else {
    startTourAutoplay();
  }
});
initWhyShowcase();
initFeatureReveal();
updateChrome();
updateFlowAnimation();
