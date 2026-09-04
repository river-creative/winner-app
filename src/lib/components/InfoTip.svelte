<script lang="ts">
  interface Props {
    text: string;
  }

  let { text }: Props = $props();
</script>

<!--
  A native `title` rather than a Bootstrap tooltip.

  The old page instantiated a Bootstrap tooltip on every `[title]` element in the document,
  which meant loading Bootstrap's JavaScript for a hint. `title` is announced by screen readers,
  works without script, and cannot get stuck open on a touch device the way the tooltip
  component did. The icon is focusable so keyboard users can reach the hint too.
-->
<button
  type="button"
  class="btn btn-link p-0 ms-1 align-baseline text-secondary"
  title={text}
  aria-label={text}
>
  <i class="bi bi-info-circle" aria-hidden="true"></i>
</button>
