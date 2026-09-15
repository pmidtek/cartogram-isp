<script setup lang="ts">
import MarkdownIt from "markdown-it";
//   import MarkdownItAbbr from "markdown-it-abbr";
//   import MarkdownItAnchor from "markdown-it-anchor";
//   import MarkdownItFootnote from "markdown-it-footnote";
//   import MarkdownItHighlightjs from "markdown-it-highlightjs";
//   import MarkdownItSub from "markdown-it-sub";
//   import MarkdownItSup from "markdown-it-sup";
//   import MarkdownItTasklists from "markdown-it-task-lists";
//   import MarkdownItTOC from "markdown-it-toc-done-right";

const markdown = new MarkdownIt();
// .use(MarkdownItAbbr)
// .use(MarkdownItAnchor)
// .use(MarkdownItFootnote)
// .use(MarkdownItHighlightjs)
// .use(MarkdownItSub)
// .use(MarkdownItSup)
// .use(MarkdownItTasklists)
// .use(MarkdownItTOC);

const def = `default value`;

defineProps({
  source: {
    type: String,
    default: def,
  },
});
</script>

<template>
  <article
    v-html="markdown.render(source)"
    class="prose prose-sm prose-headings:text-white prose-p:text-grey-400 prose-a:text-grey-300 prose-strong:text-grey-200 prose-td:text-grey-400 prose-li:text-grey-400"
  ></article>
</template>
