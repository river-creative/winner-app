<script lang="ts">
	import { winnersFilterStore } from '$stores/filters.svelte';
	import { dataStore } from '$stores/data.svelte';

	interface Props {
		showBatch?: boolean;
	}

	let { showBatch = true }: Props = $props();

	const hasActiveFilters = $derived(
		winnersFilterStore.filterPrize !== '' ||
			winnersFilterStore.filterList !== '' ||
			winnersFilterStore.filterBatch !== '' ||
			winnersFilterStore.filterDate !== ''
	);
</script>

<div class="winner-filters mb-3">
	<div class="row g-2 align-items-end">
		<!-- Prize Filter -->
		<div class="col-md-3">
			<label class="form-label small text-muted mb-1" for="filter-prize">Prize</label>
			<select
				id="filter-prize"
				class="form-select form-select-sm"
				bind:value={winnersFilterStore.filterPrize}
			>
				<option value="">All Prizes</option>
				{#each winnersFilterStore.uniquePrizes as prize}
					<option value={prize}>{prize}</option>
				{/each}
			</select>
		</div>

		<!-- List Filter -->
		<div class="col-md-3">
			<label class="form-label small text-muted mb-1" for="filter-list">List</label>
			<select
				id="filter-list"
				class="form-select form-select-sm"
				bind:value={winnersFilterStore.filterList}
			>
				<option value="">All Lists</option>
				{#each winnersFilterStore.uniqueLists as list}
					<option value={list}>{list}</option>
				{/each}
			</select>
		</div>

		<!-- Batch Filter (optional) -->
		{#if showBatch}
			<div class="col-md-3">
				<label class="form-label small text-muted mb-1" for="filter-batch">Batch</label>
				<select
					id="filter-batch"
					class="form-select form-select-sm"
					bind:value={winnersFilterStore.filterBatch}
				>
					<option value="">All Batches</option>
					{#each winnersFilterStore.uniqueBatches as batch}
						<option value={batch.id}>{batch.label}</option>
					{/each}
				</select>
			</div>
		{/if}

		<!-- Date Filter -->
		<div class="col-md-2">
			<label class="form-label small text-muted mb-1" for="filter-date">Date</label>
			<input
				type="date"
				id="filter-date"
				class="form-control form-control-sm"
				bind:value={winnersFilterStore.filterDate}
			/>
		</div>

		<!-- Clear Button -->
		<div class="col-auto">
			{#if hasActiveFilters}
				<button
					type="button"
					class="btn btn-outline-secondary btn-sm"
					onclick={() => winnersFilterStore.clearFilters()}
				>
					<i class="bi bi-x-circle me-1"></i>
					Clear
				</button>
			{/if}
		</div>
	</div>

	<!-- Active Filters Summary -->
	{#if hasActiveFilters}
		<div class="mt-2">
			<small class="text-muted">
				Showing {winnersFilterStore.filtered.length} of {dataStore.winners.length} winners
			</small>
		</div>
	{/if}
</div>
