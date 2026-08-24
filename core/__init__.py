"""核心模块 __init__"""
from core.entropy.evaluator import EntropyEvaluator
from core.memory.project_memory import ProjectMemory
from core.indexer.vector_indexer import VectorIndexer
from core.indexer.warehouse_analyzer import WarehouseAnalyzer
from core.git.intelligence import GitIntelligence
from core.lint.manager import LintManager
from core.autoheal.manager import AutoHealManager
from core.completion.semantic import SemanticCompletion
from core.debug.manager import DebugManager
from core.perf.optimizer import PerfOptimizer
from core.chunker.semantic import SemanticChunker
from core.batch.modifier import BatchModifier
from core.runner.unattended import UnattendedRunner
from core.trimmer.context_trimmer import ContextTrimmer
from core.trimmer.smart import SmartTrimmer
from core.context.entropy_controller import EntropyController
from core.config.manager import ConfigManager
from core.arch.analyzer import ArchAnalyzer
from core.compat.project_compat import ProjectCompatManager
from core.mcp.client import McpClient

__all__ = [
    'EntropyEvaluator', 'ProjectMemory', 'VectorIndexer', 'WarehouseAnalyzer',
    'GitIntelligence', 'LintManager', 'AutoHealManager', 'SemanticCompletion',
    'DebugManager', 'PerfOptimizer', 'SemanticChunker', 'BatchModifier',
    'UnattendedRunner', 'ContextTrimmer', 'SmartTrimmer', 'EntropyController',
    'ConfigManager', 'ArchAnalyzer', 'ProjectCompatManager', 'McpClient',
]
