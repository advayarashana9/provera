import asyncio
import pytest
import copy
from app.services.cache_service import CacheService

@pytest.mark.asyncio
async def test_cache_get_or_set():
    cache = CacheService()
    call_count = 0

    async def fetcher():
        nonlocal call_count
        call_count += 1
        return {"data": call_count}

    # First fetch - miss
    res1 = await cache.get_or_set("key1", 10, fetcher)
    assert res1 == {"data": 1}
    assert call_count == 1

    # Second fetch - hit
    res2 = await cache.get_or_set("key1", 10, fetcher)
    assert res2 == {"data": 1}
    assert call_count == 1

@pytest.mark.asyncio
async def test_cache_mutation_immunity():
    cache = CacheService()

    async def fetcher():
        return {"list": [1, 2, 3]}

    res = await cache.get_or_set("key_mut", 10, fetcher)
    res["list"].append(4)  # Mutate returned object

    res2 = await cache.get_or_set("key_mut", 10, fetcher)
    assert res2 == {"list": [1, 2, 3]}  # Cache source is unmodified

@pytest.mark.asyncio
async def test_cache_single_flight():
    cache = CacheService()
    call_count = 0
    start_event = asyncio.Event()

    async def fetcher():
        nonlocal call_count
        await start_event.wait()
        call_count += 1
        return {"data": call_count}

    # Fire two requests concurrently
    t1 = asyncio.create_task(cache.get_or_set("single_flight", 10, fetcher))
    t2 = asyncio.create_task(cache.get_or_set("single_flight", 10, fetcher))

    # Allow fetcher to complete
    start_event.set()

    res1, res2 = await asyncio.gather(t1, t2)
    assert res1 == {"data": 1}
    assert res2 == {"data": 1}
    assert call_count == 1  # Fetcher called exactly once!

@pytest.mark.asyncio
async def test_cache_no_failure_caching():
    cache = CacheService()
    call_count = 0

    async def fetcher():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise ValueError("First call fails")
        return {"data": call_count}

    # First attempt fails
    with pytest.raises(ValueError):
        await cache.get_or_set("fail_key", 10, fetcher)

    # Second attempt succeeds and should NOT be blocked by cached failure
    res = await cache.get_or_set("fail_key", 10, fetcher)
    assert res == {"data": 2}

@pytest.mark.asyncio
async def test_cache_ttl_expiration():
    cache = CacheService()
    call_count = 0

    async def fetcher():
        nonlocal call_count
        call_count += 1
        return {"data": call_count}

    # Set with 0 TTL (expires immediately)
    res1 = await cache.get_or_set("ttl_key", 0, fetcher)
    assert res1 == {"data": 1}

    # Fetching again should miss and re-call
    res2 = await cache.get_or_set("ttl_key", 0, fetcher)
    assert res2 == {"data": 2}
