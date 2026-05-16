const defaultSubreddits = ["investing", "stocks", "economics", "SecurityAnalysis"];

function configuredSubreddits() {
  const raw = process.env.REDDIT_SUBREDDITS?.trim();
  if (!raw) {
    return defaultSubreddits;
  }

  return raw.split(",").map((name) => name.trim()).filter(Boolean);
}

function redditUserAgent() {
  return process.env.REDDIT_USER_AGENT || "personal-whatsapp-assistant/0.1";
}

export async function fetchRedditPosts({ perSubredditLimit = 5 } = {}) {
  const subreddits = configuredSubreddits();
  const posts = [];
  const errors = [];

  for (const subreddit of subreddits) {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${perSubredditLimit}`;

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": redditUserAgent() },
      });

      if (!response.ok) {
        errors.push(`r/${subreddit}: HTTP ${response.status}`);
        continue;
      }

      const payload = await response.json();
      for (const child of payload?.data?.children || []) {
        const post = child.data;
        if (!post?.title) {
          continue;
        }

        posts.push({
          subreddit,
          title: post.title,
          score: post.score,
          comments: post.num_comments,
          url: `https://www.reddit.com${post.permalink}`,
          text: (post.selftext || "").slice(0, 400),
        });
      }
    } catch (error) {
      errors.push(`r/${subreddit}: ${error.message}`);
    }
  }

  return { posts, errors };
}

export function formatRedditForPrompt(posts) {
  if (!posts.length) {
    return "No Reddit posts were fetched.";
  }

  return posts
    .map((post, index) => {
      const parts = [
        `${index + 1}. [r/${post.subreddit}] ${post.title}`,
        `   Score: ${post.score} | Comments: ${post.comments}`,
        post.text ? `   Text: ${post.text.slice(0, 200)}` : "",
        `   Link: ${post.url}`,
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n\n");
}
