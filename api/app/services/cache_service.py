import asyncio
import time
import copy
import logging
import threading
from typing import Dict, Any, Callable, Awaitable, Tuple, Optional

logger = logging.getLogger(__name__)

class CacheService:
    def __init__(self):
        self._cache: Dict[str, Tuple[Any, float]] = {}  # key -> (value, expiry_time)
        self._locks: Dict[str, asyncio.Lock] = {}
        self._thread_lock = threading.Lock()

    def _clean_expired(self) -> None:
        """Remove expired keys from cache."""
        now = time.time()
        expired_keys = [k for k, (_, exp) in self._cache.items() if now >= exp]
        for k in expired_keys:
            if k in self._cache:
                del self._cache[k]
            if k in self._locks:
                del self._locks[k]

    def get_sync(self, key: str) -> Optional[Any]:
        """Synchronous cache lookup (thread-safe)."""
        with self._thread_lock:
            self._clean_expired()
            if key in self._cache:
                val, _ = self._cache[key]
                logger.info(f"[CACHE HIT] Key: {key}")
                return copy.deepcopy(val)
            logger.info(f"[CACHE MISS] Key: {key}")
            return None

    def set_sync(self, key: str, value: Any, ttl_seconds: float) -> None:
        """Synchronous cache store (thread-safe)."""
        with self._thread_lock:
            self._clean_expired()
            expiry = time.time() + ttl_seconds
            self._cache[key] = (copy.deepcopy(value), expiry)
            logger.info(f"[CACHE SET] Key: {key} (TTL: {ttl_seconds}s)")

    async def get_or_set(
        self, key: str, ttl_seconds: float, func: Callable[..., Awaitable[Any]], *args: Any, **kwargs: Any
    ) -> Any:
        # Check cache sync first
        cached_val = self.get_sync(key)
        if cached_val is not None:
            return cached_val

        # Manage key-specific lock under thread-safety
        with self._thread_lock:
            if key not in self._locks:
                self._locks[key] = asyncio.Lock()
            lock = self._locks[key]

        # Acquire lock to prevent duplicate concurrent requests
        async with lock:
            # Double check
            cached_val = self.get_sync(key)
            if cached_val is not None:
                return cached_val

            # Resolve
            result = await func(*args, **kwargs)
            
            # Store in cache
            self.set_sync(key, result, ttl_seconds)
            return copy.deepcopy(result)

# Singleton cache instance
cache_service = CacheService()
