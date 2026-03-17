<script lang="ts">
	import type { Prize } from '$types';

	interface Props {
		prize: Prize;
		isSelected?: boolean;
		showSelectButton?: boolean;
		onSelect?: (prize: Prize) => void;
		onEdit?: (prize: Prize) => void;
		onDelete?: (prize: Prize) => void;
	}

	let { prize, isSelected = false, showSelectButton = false, onSelect, onEdit, onDelete }: Props =
		$props();

	const hasTemplate = $derived(!!prize.templateId);
	const isLowQuantity = $derived(prize.quantity <= 3 && prize.quantity > 0);
	const isOutOfStock = $derived(prize.quantity === 0);
</script>

<div
	class="card prize-card h-100"
	class:border-warning={isLowQuantity && !isSelected}
	class:border-danger={isOutOfStock && !isSelected}
	class:border-selected={isSelected}
>
	<div class="card-body d-flex flex-column">
		<div class="d-flex justify-content-between align-items-start mb-2">
			<h6 class="card-title mb-0 text-truncate" title={prize.name}>
				<i class="bi bi-trophy me-1 text-warning"></i>
				{prize.name}
			</h6>
			{#if hasTemplate}
				<span class="badge bg-info" title="Has SMS Template">
					<i class="bi bi-chat-text"></i>
				</span>
			{/if}
		</div>

		<div class="quantity-badge mb-2">
			{#if isOutOfStock}
				<span class="badge bg-danger fs-6">Out of Stock</span>
			{:else if isLowQuantity}
				<span class="badge bg-warning text-dark fs-6">{prize.quantity} remaining</span>
			{:else}
				<span class="badge bg-primary fs-6">{prize.quantity} remaining</span>
			{/if}
		</div>

		{#if prize.description}
			<p class="card-text text-muted small mb-2 flex-grow-1">
				{prize.description}
			</p>
		{/if}

		{#if prize.winnersCount}
			<small class="text-muted d-block mb-2">
				<i class="bi bi-people me-1"></i>
				Default winners: {prize.winnersCount}
			</small>
		{/if}

		<div class="mt-auto pt-2">
			{#if showSelectButton}
				<button
					type="button"
					class="btn w-100 mb-2"
					class:btn-success={isSelected}
					class:btn-outline-primary={!isSelected}
					onclick={() => onSelect?.(prize)}
					disabled={isOutOfStock}
				>
					{#if isSelected}
						<i class="bi bi-check-circle-fill me-1"></i>Selected
					{:else}
						<i class="bi bi-circle me-1"></i>Select
					{/if}
				</button>
			{/if}
			<div class="btn-group btn-group-sm w-100" role="group">
				{#if onEdit}
					<button
						type="button"
						class="btn btn-outline-secondary"
						onclick={() => onEdit?.(prize)}
						title="Edit prize"
					>
						<i class="bi bi-pencil me-1"></i>Edit
					</button>
				{/if}
				{#if onDelete}
					<button
						type="button"
						class="btn btn-outline-danger"
						onclick={() => onDelete?.(prize)}
						title="Delete prize"
					>
						<i class="bi bi-trash me-1"></i>Delete
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.prize-card {
		transition:
			transform 0.15s ease-in-out,
			box-shadow 0.15s ease-in-out;
	}

	.prize-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.card-title {
		max-width: 200px;
	}

	.quantity-badge {
		text-align: center;
	}

	.border-selected {
		border: 2px solid var(--bs-success) !important;
		box-shadow: 0 0 0 0.2rem rgba(25, 135, 84, 0.25);
	}
</style>
