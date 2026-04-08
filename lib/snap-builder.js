/**
 * Build the snap JSON tree for a steelman, given the current view.
 *
 * Snaps are server-driven: every GET / POST returns a complete UI tree.
 * "Tabs" don't exist in the spec — we just return a different element map
 * depending on which view the user is currently looking at.
 */

/**
 * Public URL of this server. Vercel sets VERCEL_URL automatically (without scheme),
 * so we fall back to that. SNAP_PUBLIC_URL overrides for local dev / custom domains.
 */
function publicBaseUrl() {
  const explicit = process.env.SNAP_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function snapUrl(id) {
  return `${publicBaseUrl()}/api/snap/${id}`;
}

function feedbackUrl(id, view) {
  return `${publicBaseUrl()}/api/snap/feedback?id=${encodeURIComponent(id)}&view=${view}`;
}

const VIEWS = {
  strong: { label: 'Strongest', heading: 'The strongest version' },
  weak: { label: 'Weakest', heading: 'The weakest version' },
  agree: { label: 'Common ground', heading: 'What both sides could agree on' }
};

/**
 * @param {import('./storage').Steelman} s
 * @param {'strong'|'weak'|'agree'|'rated'} view
 * @param {{ count: number, avg: number }} stats
 */
function buildSnap(s, view, stats) {
  if (view === 'rated') {
    return ratedView(s, stats);
  }

  const passage = s[view] || s.strong;
  const heading = VIEWS[view]?.heading || VIEWS.strong.heading;

  const elements = {
    root: {
      type: 'stack',
      props: { direction: 'vertical', gap: 'md' },
      children: ['title', 'quote', 'heading', 'passage', 'viewButtons', 'divider', 'slider', 'submit', 'footer']
    },
    title: {
      type: 'text',
      props: { content: `Steelman of @${s.parentAuthor || 'anon'}`, weight: 'bold', size: 'lg' }
    },
    quote: {
      type: 'text',
      props: { content: `"${truncate(s.parentText, 240)}"`, size: 'sm' }
    },
    heading: {
      type: 'text',
      props: { content: heading, weight: 'bold', size: 'md' }
    },
    passage: {
      type: 'text',
      props: { content: passage, size: 'md' }
    },
    viewButtons: {
      type: 'stack',
      props: { direction: 'horizontal', gap: 'sm' },
      children: ['btnStrong', 'btnWeak', 'btnAgree']
    },
    btnStrong: viewButton(s.id, 'strong', view),
    btnWeak: viewButton(s.id, 'weak', view),
    btnAgree: viewButton(s.id, 'agree', view),
    divider: {
      type: 'text',
      props: { content: '— Did this change your mind? —', size: 'sm' }
    },
    slider: {
      type: 'slider',
      props: {
        name: 'rating',
        label: 'Mind changed (1 = not at all, 5 = a lot)',
        min: 1,
        max: 5,
        step: 1,
        defaultValue: 3
      }
    },
    submit: {
      type: 'button',
      props: { label: 'Submit rating', variant: 'primary' },
      on: {
        press: { action: 'submit', params: { target: feedbackUrl(s.id, 'rated') } }
      }
    },
    footer: {
      type: 'text',
      props: { content: ratingFooter(stats), size: 'sm' }
    }
  };

  return { version: '1.0', ui: { root: 'root', elements } };
}

function ratedView(s, stats) {
  return {
    version: '1.0',
    effects: ['confetti'],
    ui: {
      root: 'root',
      elements: {
        root: {
          type: 'stack',
          props: { direction: 'vertical', gap: 'md' },
          children: ['title', 'thanks', 'stats', 'reread']
        },
        title: {
          type: 'text',
          props: { content: 'Thanks for rating', weight: 'bold', size: 'lg' }
        },
        thanks: {
          type: 'text',
          props: {
            content: 'Your rating helps us tune future steelmans toward the arguments people actually find persuasive.',
            size: 'sm'
          }
        },
        stats: {
          type: 'text',
          props: { content: ratingFooter(stats), weight: 'bold', size: 'md' }
        },
        reread: {
          type: 'button',
          props: { label: 'Re-read', variant: 'secondary' },
          on: {
            press: { action: 'submit', params: { target: feedbackUrl(s.id, 'strong') } }
          }
        }
      }
    }
  };
}

function viewButton(id, view, currentView) {
  return {
    type: 'button',
    props: {
      label: VIEWS[view].label,
      variant: currentView === view ? 'primary' : 'secondary'
    },
    on: {
      press: { action: 'submit', params: { target: feedbackUrl(id, view) } }
    }
  };
}

function ratingFooter(stats) {
  if (!stats || !stats.count) return 'No ratings yet — be the first.';
  return `Avg: ${stats.avg.toFixed(1)} / 5 across ${stats.count} rater${stats.count === 1 ? '' : 's'}`;
}

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

module.exports = { buildSnap, snapUrl, feedbackUrl, publicBaseUrl };
