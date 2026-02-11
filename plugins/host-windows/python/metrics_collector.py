#!/usr/bin/env python3
#
# JunctionRelay — Host Windows Collector Plugin
#
# Ported from JunctionRelay XSD metrics_collector.py
# Collects system metrics using psutil and platform-specific APIs.
#
# Copyright (C) 2024-present Jonathan Mills, CatapultCase
# All Rights Reserved.
#

"""
Fast metrics collector using psutil.
Runs as a persistent daemon, reading commands from stdin and outputting JSON to stdout.
"""

import json
import sys
import os
import platform
import socket
import subprocess

# Try to import psutil, install from bundled wheels if not available
try:
    import psutil
except ImportError:
    # Look for bundled wheels in the same directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    wheels_dir = os.path.join(script_dir, 'wheels')

    if os.path.exists(wheels_dir):
        # Find psutil wheel for current Python version
        py_version = f"cp{sys.version_info.major}{sys.version_info.minor}"
        wheels = [f for f in os.listdir(wheels_dir) if f.endswith('.whl')]

        # Install all wheels (psutil and GPUtil)
        for wheel in wheels:
            wheel_path = os.path.join(wheels_dir, wheel)
            try:
                subprocess.check_call(
                    [sys.executable, '-m', 'pip', 'install', '--user', '--quiet', wheel_path],
                    stderr=subprocess.DEVNULL
                )
            except subprocess.CalledProcessError:
                pass  # Ignore if already installed or wrong version

        # Try import again
        import psutil
    else:
        sys.stderr.write("ERROR: psutil not installed and no bundled wheels found\n")
        sys.exit(1)


# Global cache for static sensors (populated on first poll, cleared on mode change)
_static_cache = None
_gpu_reader_static_cache = None  # Cache for gpu-reader.exe static data (Windows only)

def clear_static_cache():
    """Clear the static sensor cache."""
    global _static_cache, _gpu_reader_static_cache
    _static_cache = None
    _gpu_reader_static_cache = None


def make_sensor(value, unit, sensor_tag, raw_label='psutil', poller_source='psutil'):
    """Create a sensor object with metadata."""
    return {
        'value': value,
        'unit': unit,
        'sensorTag': sensor_tag,
        'pollerSource': poller_source,
        'rawLabel': raw_label
    }


def collect_system():
    """Collect system information."""
    return {
        'hostname': make_sensor(socket.gethostname(), 'text', 'system_hostname', 'socket.gethostname()'),
        'platform': make_sensor(platform.system(), 'text', 'system_platform', 'platform.system()'),
        'uptime': make_sensor(int(psutil.boot_time()), 'seconds', 'system_uptime', 'psutil.boot_time()')
    }


def collect_cpu():
    """Collect CPU metrics."""
    metrics = {}

    # CPU name - platform specific (get friendly name, not generic identifier)
    try:
        if platform.system() == 'Windows':
            # Windows: Read from registry for friendly name like "AMD Ryzen 9 7945HX" or "Intel Core i5-14600K"
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            winreg.CloseKey(key)
            cpu_name = cpu_name.strip()
        elif platform.system() == 'Linux':
            cpu_name = "CPU"
            with open('/proc/cpuinfo', 'r') as f:
                for line in f:
                    if 'model name' in line:
                        cpu_name = line.split(':')[1].strip()
                        break
        else:
            cpu_name = platform.processor() or "CPU"
    except:
        cpu_name = platform.processor() or "CPU"

    metrics['name'] = make_sensor(cpu_name, 'text', 'cpu_name', 'winreg / /proc/cpuinfo')

    # Overall CPU usage (use cached value since we're polling frequently)
    metrics['usage_total'] = make_sensor(round(psutil.cpu_percent(interval=None), 1), '%', 'cpu_usage_total', 'psutil.cpu_percent()')

    # CPU frequency
    freq = psutil.cpu_freq()
    if freq:
        metrics['frequency'] = make_sensor(round(freq.current, 1), 'MHz', 'cpu_frequency', 'psutil.cpu_freq().current')

    # CPU temperature (if available)
    try:
        temps = psutil.sensors_temperatures()
        if temps:
            if 'coretemp' in temps:
                core_temps = [t.current for t in temps['coretemp'] if 'Core' in t.label]
                if core_temps:
                    metrics['temperature'] = make_sensor(round(sum(core_temps) / len(core_temps), 1), '°C', 'cpu_temperature', 'psutil.sensors_temperatures()[coretemp]')
            elif 'cpu_thermal' in temps:
                metrics['temperature'] = make_sensor(round(temps['cpu_thermal'][0].current, 1), '°C', 'cpu_temperature', 'psutil.sensors_temperatures()[cpu_thermal]')
    except:
        pass

    # Core counts
    metrics['core_count'] = make_sensor(psutil.cpu_count(logical=False) or psutil.cpu_count(), 'cores', 'cpu_core_count', 'psutil.cpu_count(logical=False)')
    metrics['thread_count'] = make_sensor(psutil.cpu_count(logical=True), 'threads', 'cpu_thread_count', 'psutil.cpu_count(logical=True)')

    return metrics


def collect_gpu():
    """Collect GPU metrics.

    Tries in order:
    1. AMD sysfs (Linux)
    2. GPUtil (NVIDIA)
    3. Windows native via gpu-reader.exe (AMD APUs, Intel integrated, etc.)
    """

    # Try AMD GPU sysfs first (for Steam Deck / Linux AMD)
    if platform.system() == 'Linux':
        amd_gpu = collect_amd_gpu_sysfs()
        if amd_gpu:
            return amd_gpu

    # Try GPUtil for NVIDIA
    try:
        import GPUtil

        # Get all GPUs
        gpus = GPUtil.getGPUs()

        if gpus:
            # Get first GPU
            gpu = gpus[0]

            # GPU metrics
            name = gpu.name
            gpu_usage = round(gpu.load * 100, 1)  # Convert to percentage
            temperature = round(gpu.temperature, 1) if gpu.temperature else 0
            vram_used = round(gpu.memoryUsed, 1)
            vram_total = round(gpu.memoryTotal, 1)
            vram_usage_percent = round(gpu.memoryUtil * 100, 1)

            return {
                'name': make_sensor(name, 'text', 'gpu_name', 'GPUtil.gpu.name'),
                'usage': make_sensor(gpu_usage, '%', 'gpu_usage', 'GPUtil.gpu.load'),
                'temperature': make_sensor(temperature, '°C', 'gpu_temperature', 'GPUtil.gpu.temperature'),
                'vram_used': make_sensor(vram_used, 'MB', 'gpu_vram_used', 'GPUtil.gpu.memoryUsed'),
                'vram_total': make_sensor(vram_total, 'MB', 'gpu_vram_total', 'GPUtil.gpu.memoryTotal'),
                'vram_usage_percent': make_sensor(vram_usage_percent, '%', 'gpu_vram_usage_percent', 'GPUtil.gpu.memoryUtil'),
            }

    except ImportError:
        pass  # GPUtil not installed
    except Exception:
        pass  # GPUtil failed

    # Fall back to Windows native (AMD APUs, Intel integrated, etc.)
    if platform.system() == 'Windows':
        windows_gpu = collect_gpu_windows_native()
        if windows_gpu:
            return windows_gpu

    # No GPU detected
    return {}


def _find_gpu_reader():
    """Find gpu-reader.exe path using PLUGIN_BINARIES_PATH env var."""
    binaries_path = os.environ.get('PLUGIN_BINARIES_PATH')
    if not binaries_path:
        return None
    gpu_reader = os.path.join(binaries_path, 'gpu-reader.exe')
    if os.path.exists(gpu_reader):
        return gpu_reader
    return None


def _call_gpu_reader(mode):
    """Call gpu-reader.exe with specified mode (--static, --dynamic, or --all)."""
    gpu_reader = _find_gpu_reader()
    if not gpu_reader:
        return None

    try:
        result = subprocess.run(
            [gpu_reader, mode],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        return data if data.get('success') else None
    except Exception:
        return None


def collect_gpu_windows_native_static():
    """Collect ONLY static GPU data from gpu-reader.exe (cached after first call)."""
    global _gpu_reader_static_cache

    if platform.system() != 'Windows':
        return None

    # Return cached data if available
    if _gpu_reader_static_cache is not None:
        return _gpu_reader_static_cache

    data = _call_gpu_reader('--static')
    if not data:
        return None

    static = data.get('static', {})
    sensors = {}

    if static.get('gpu_name'):
        sensors['name'] = make_sensor(static['gpu_name'], 'text', 'gpu_name', 'WMI VideoController.Name', 'gpu-reader.exe')

    if static.get('gpu_vram_total_bytes'):
        vram_total_mb = round(static['gpu_vram_total_bytes'] / 1024 / 1024, 1)
        sensors['vram_total'] = make_sensor(vram_total_mb, 'MB', 'gpu_vram_total', 'WMI VideoController.AdapterRAM', 'gpu-reader.exe')

    _gpu_reader_static_cache = sensors if sensors else None
    return _gpu_reader_static_cache


def collect_gpu_windows_native_dynamic():
    """Collect ONLY dynamic GPU data from gpu-reader.exe (called each poll)."""
    if platform.system() != 'Windows':
        return None

    data = _call_gpu_reader('--dynamic')
    if not data:
        return None

    dynamic = data.get('dynamic', {})
    sensors = {}

    if 'gpu_usage_percent' in dynamic:
        sensors['usage'] = make_sensor(round(dynamic['gpu_usage_percent'], 1), '%', 'gpu_usage', 'PDH GPU Engine Utilization', 'gpu-reader.exe')

    if dynamic.get('gpu_vram_used_bytes'):
        vram_used_mb = round(dynamic['gpu_vram_used_bytes'] / 1024 / 1024, 1)
        sensors['vram_used'] = make_sensor(vram_used_mb, 'MB', 'gpu_vram_used', 'PDH Dedicated Memory Usage', 'gpu-reader.exe')

    return sensors if sensors else None


def collect_gpu_windows_native():
    """Collect GPU metrics using Windows native APIs via gpu-reader.exe.

    Uses cached static data + fresh dynamic data for efficiency.
    Static (WMI): gpu_name, gpu_vram_total - queried once
    Dynamic (PDH): gpu_usage, gpu_vram_used - queried each poll
    """
    if platform.system() != 'Windows':
        return None

    # Get cached static data (or fetch if first call)
    static_sensors = collect_gpu_windows_native_static() or {}

    # Get fresh dynamic data
    dynamic_sensors = collect_gpu_windows_native_dynamic() or {}

    # Merge static + dynamic
    sensors = {**static_sensors, **dynamic_sensors}

    # Calculate vram_usage_percent if we have both values
    if sensors.get('vram_used') and sensors.get('vram_total'):
        vram_used = sensors['vram_used']['value']
        vram_total = sensors['vram_total']['value']
        if vram_total > 0:
            vram_percent = round((vram_used / vram_total) * 100, 1)
            sensors['vram_usage_percent'] = make_sensor(vram_percent, '%', 'gpu_vram_usage_percent', 'vram_used / vram_total', 'gpu-reader.exe')

    return sensors if sensors else None


def collect_amd_gpu_sysfs():
    """Collect AMD GPU metrics from Linux sysfs. Returns None if not AMD or not available."""
    import glob

    try:
        # Find AMD GPU in /sys/class/drm
        drm_path = '/sys/class/drm'
        if not os.path.exists(drm_path):
            return None

        # Find card with gpu_busy_percent (AMD indicator)
        gpu_path = None
        hwmon_path = None

        for card in sorted(os.listdir(drm_path)):
            if not card.startswith('card') or '-' in card:
                continue

            device_path = os.path.join(drm_path, card, 'device')
            busy_path = os.path.join(device_path, 'gpu_busy_percent')

            if os.path.exists(busy_path):
                gpu_path = device_path
                # Find hwmon
                hwmon_dir = os.path.join(device_path, 'hwmon')
                if os.path.exists(hwmon_dir):
                    hwmons = os.listdir(hwmon_dir)
                    if hwmons:
                        hwmon_path = os.path.join(hwmon_dir, hwmons[0])
                break

        if not gpu_path:
            return None

        result = {}

        # GPU name
        product_path = os.path.join(gpu_path, 'product_name')
        if os.path.exists(product_path):
            with open(product_path, 'r') as f:
                result['name'] = make_sensor(f.read().strip(), 'text', 'gpu_name', 'sysfs: product_name')
        else:
            result['name'] = make_sensor('AMD GPU', 'text', 'gpu_name', 'sysfs: AMD GPU (default)')

        # GPU usage
        busy_path = os.path.join(gpu_path, 'gpu_busy_percent')
        if os.path.exists(busy_path):
            with open(busy_path, 'r') as f:
                result['usage'] = make_sensor(int(f.read().strip()), '%', 'gpu_usage', 'sysfs: gpu_busy_percent')

        # VRAM used (bytes -> MB)
        vram_used_path = os.path.join(gpu_path, 'mem_info_vram_used')
        vram_used = 0
        if os.path.exists(vram_used_path):
            with open(vram_used_path, 'r') as f:
                vram_used = int(f.read().strip()) // (1024 * 1024)
                result['vram_used'] = make_sensor(vram_used, 'MB', 'gpu_vram_used', 'sysfs: mem_info_vram_used')

        # VRAM total (bytes -> MB)
        vram_total_path = os.path.join(gpu_path, 'mem_info_vram_total')
        vram_total = 0
        if os.path.exists(vram_total_path):
            with open(vram_total_path, 'r') as f:
                vram_total = int(f.read().strip()) // (1024 * 1024)
                result['vram_total'] = make_sensor(vram_total, 'MB', 'gpu_vram_total', 'sysfs: mem_info_vram_total')

        # VRAM usage percent (only if both vram values are available)
        if vram_total > 0 and vram_used > 0:
            vram_percent = round((vram_used / vram_total) * 100, 1)
            result['vram_usage_percent'] = make_sensor(vram_percent, '%', 'gpu_vram_usage_percent', 'sysfs: calculated from vram_used/vram_total')

        # Temperature from hwmon (millidegrees -> degrees)
        if hwmon_path:
            temp_path = os.path.join(hwmon_path, 'temp1_input')
            if os.path.exists(temp_path):
                with open(temp_path, 'r') as f:
                    temp = int(f.read().strip()) // 1000
                    result['temperature'] = make_sensor(temp, '°C', 'gpu_temperature', 'sysfs: hwmon/temp1_input')

            # Power (microwatts -> watts)
            power_path = os.path.join(hwmon_path, 'power1_average')
            if os.path.exists(power_path):
                with open(power_path, 'r') as f:
                    power = int(f.read().strip()) // 1000000
                    result['power_draw'] = make_sensor(power, 'W', 'gpu_power_draw', 'sysfs: hwmon/power1_average')

            # Fan speed
            fan_path = os.path.join(hwmon_path, 'fan1_input')
            fan_max_path = os.path.join(hwmon_path, 'fan1_max')
            if os.path.exists(fan_path):
                with open(fan_path, 'r') as f:
                    fan_rpm = int(f.read().strip())
                fan_percent = 0
                if os.path.exists(fan_max_path):
                    with open(fan_max_path, 'r') as f:
                        fan_max = int(f.read().strip())
                    if fan_max > 0:
                        fan_percent = round((fan_rpm / fan_max) * 100)
                result['fan_speed_percent'] = make_sensor(fan_percent, '%', 'gpu_fan_speed_percent', 'sysfs: hwmon/fan1_input')

            # GPU frequency (Hz -> MHz)
            freq_path = os.path.join(hwmon_path, 'freq1_input')
            if os.path.exists(freq_path):
                with open(freq_path, 'r') as f:
                    freq = int(f.read().strip()) // 1000000
                    result['frequency'] = make_sensor(freq, 'MHz', 'gpu_frequency', 'sysfs: hwmon/freq1_input')

        return result

    except Exception:
        return None


def collect_memory():
    """Collect memory metrics."""
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()

    return {
        'used': make_sensor(round(mem.used / 1024 / 1024, 1), 'MB', 'memory_used', 'psutil.virtual_memory().used'),
        'total': make_sensor(round(mem.total / 1024 / 1024, 1), 'MB', 'memory_total', 'psutil.virtual_memory().total'),
        'available': make_sensor(round(mem.available / 1024 / 1024, 1), 'MB', 'memory_available', 'psutil.virtual_memory().available'),
        'usage_percent': make_sensor(round(mem.percent, 1), '%', 'memory_usage_percent', 'psutil.virtual_memory().percent'),
        'swap_used': make_sensor(round(swap.used / 1024 / 1024, 1), 'MB', 'memory_swap_used', 'psutil.swap_memory().used'),
        'swap_total': make_sensor(round(swap.total / 1024 / 1024, 1), 'MB', 'memory_swap_total', 'psutil.swap_memory().total')
    }


def collect_disk():
    """Collect disk metrics."""
    # Get primary disk usage
    if platform.system() == 'Windows':
        disk = psutil.disk_usage('C:\\')
    else:
        disk = psutil.disk_usage('/')
    io = psutil.disk_io_counters()

    metrics = {
        'used': make_sensor(round(disk.used / 1024 / 1024 / 1024, 1), 'GB', 'disk_used', 'psutil.disk_usage().used'),
        'total': make_sensor(round(disk.total / 1024 / 1024 / 1024, 1), 'GB', 'disk_total', 'psutil.disk_usage().total'),
        'free': make_sensor(round(disk.free / 1024 / 1024 / 1024, 1), 'GB', 'disk_free', 'psutil.disk_usage().free'),
        'usage_percent': make_sensor(round(disk.percent, 1), '%', 'disk_usage_percent', 'psutil.disk_usage().percent')
    }

    if io:
        metrics['read_speed'] = make_sensor(0, 'MB/s', 'disk_read_speed', 'delta(bytes_read) / time', 'calculated')
        metrics['write_speed'] = make_sensor(0, 'MB/s', 'disk_write_speed', 'delta(bytes_written) / time', 'calculated')

    return metrics


def collect_network():
    """Collect network metrics."""
    net = psutil.net_io_counters()

    if net:
        return {
            'download_speed': make_sensor(0, 'MB/s', 'network_download_speed', 'delta(bytes_recv) / time', 'calculated'),
            'upload_speed': make_sensor(0, 'MB/s', 'network_upload_speed', 'delta(bytes_sent) / time', 'calculated'),
            'bytes_sent': make_sensor(net.bytes_sent, 'bytes', 'network_bytes_sent', 'psutil.net_io_counters().bytes_sent'),
            'bytes_received': make_sensor(net.bytes_recv, 'bytes', 'network_bytes_received', 'psutil.net_io_counters().bytes_recv')
        }

    return {
        'download_speed': make_sensor(0, 'MB/s', 'network_download_speed', 'psutil.net_io_counters() (unavailable)'),
        'upload_speed': make_sensor(0, 'MB/s', 'network_upload_speed', 'psutil.net_io_counters() (unavailable)'),
        'bytes_sent': make_sensor(0, 'bytes', 'network_bytes_sent', 'psutil.net_io_counters() (unavailable)'),
        'bytes_received': make_sensor(0, 'bytes', 'network_bytes_received', 'psutil.net_io_counters() (unavailable)')
    }


def collect_battery():
    """Collect battery metrics."""
    try:
        battery = psutil.sensors_battery()
        if battery:
            time_remaining_seconds = battery.secsleft if battery.secsleft != psutil.POWER_TIME_UNLIMITED else -1
            return {
                'percent': make_sensor(round(battery.percent, 1), '%', 'battery_percent', 'psutil.sensors_battery().percent'),
                'is_charging': make_sensor(battery.power_plugged and not battery.percent == 100, 'boolean', 'battery_is_charging', 'psutil.sensors_battery().power_plugged'),
                'is_plugged_in': make_sensor(battery.power_plugged, 'boolean', 'battery_is_plugged_in', 'psutil.sensors_battery().power_plugged'),
                'time_remaining': make_sensor(time_remaining_seconds, 'seconds', 'battery_time_remaining', 'psutil.sensors_battery().secsleft')
            }
    except:
        pass

    # Return empty object instead of None for systems without battery (desktops)
    return {}


def collect_cores():
    """Collect per-core CPU usage and temperature."""
    metrics = {}

    # Per-core CPU usage
    per_core = psutil.cpu_percent(interval=None, percpu=True)
    for i, usage in enumerate(per_core):
        if i >= 64:  # Max 64 cores in dictionary
            break
        metrics[f'{i}_usage'] = make_sensor(
            round(usage, 1), '%', f'cpu_core_{i}_usage',
            f'psutil.cpu_percent(percpu=True)[{i}]'
        )

    # Per-core temperatures (if available)
    try:
        temps = psutil.sensors_temperatures()
        if temps:
            if 'coretemp' in temps:
                # Intel/Linux format
                for t in temps['coretemp']:
                    if 'Core' in t.label:
                        # Extract core number from label like "Core 0"
                        try:
                            core_num = int(t.label.split()[-1])
                            if core_num < 64:
                                metrics[f'{core_num}_temp'] = make_sensor(
                                    round(t.current, 1), '°C', f'cpu_core_{core_num}_temp',
                                    f'psutil.sensors_temperatures()[coretemp][{t.label}]'
                                )
                        except (ValueError, IndexError):
                            pass
            elif 'k10temp' in temps:
                # AMD format - usually just package temp, not per-core
                pass
    except:
        pass

    return metrics


def collect_static():
    """Collect only static/slow-changing data - CACHED after first call.

    Static sensors are queried once at startup and cached forever.
    This prevents repeated expensive queries (registry reads, WMI, etc.)
    for data that never changes during runtime.
    """
    global _static_cache

    # Return cached data if available
    if _static_cache is not None:
        return _static_cache

    # CPU name - platform specific
    cpu_static = {}
    try:
        if platform.system() == 'Windows':
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            winreg.CloseKey(key)
            cpu_name = cpu_name.strip()
        elif platform.system() == 'Linux':
            cpu_name = "CPU"
            with open('/proc/cpuinfo', 'r') as f:
                for line in f:
                    if 'model name' in line:
                        cpu_name = line.split(':')[1].strip()
                        break
        else:
            cpu_name = platform.processor() or "CPU"
    except:
        cpu_name = platform.processor() or "CPU"

    cpu_static['name'] = make_sensor(cpu_name, 'text', 'cpu_name', 'winreg / /proc/cpuinfo')
    cpu_static['core_count'] = make_sensor(psutil.cpu_count(logical=False) or psutil.cpu_count(), 'cores', 'cpu_core_count', 'psutil.cpu_count(logical=False)')
    cpu_static['thread_count'] = make_sensor(psutil.cpu_count(logical=True), 'threads', 'cpu_thread_count', 'psutil.cpu_count(logical=True)')

    # GPU static
    gpu_static = {}
    # Try AMD sysfs first
    if platform.system() == 'Linux':
        try:
            drm_path = '/sys/class/drm'
            if os.path.exists(drm_path):
                for card in sorted(os.listdir(drm_path)):
                    if not card.startswith('card') or '-' in card:
                        continue
                    device_path = os.path.join(drm_path, card, 'device')
                    if os.path.exists(os.path.join(device_path, 'gpu_busy_percent')):
                        product_path = os.path.join(device_path, 'product_name')
                        if os.path.exists(product_path):
                            with open(product_path, 'r') as f:
                                gpu_static['name'] = make_sensor(f.read().strip(), 'text', 'gpu_name', 'sysfs: product_name')
                        else:
                            gpu_static['name'] = make_sensor('AMD GPU', 'text', 'gpu_name', 'sysfs: AMD GPU (default)')
                        vram_total_path = os.path.join(device_path, 'mem_info_vram_total')
                        if os.path.exists(vram_total_path):
                            with open(vram_total_path, 'r') as f:
                                vram_total = int(f.read().strip()) // (1024 * 1024)
                                gpu_static['vram_total'] = make_sensor(vram_total, 'MB', 'gpu_vram_total', 'sysfs: mem_info_vram_total')
                        break
        except:
            pass

    if not gpu_static:
        # Try GPUtil for NVIDIA
        try:
            import GPUtil
            gpus = GPUtil.getGPUs()
            if gpus:
                gpu = gpus[0]
                gpu_static['name'] = make_sensor(gpu.name, 'text', 'gpu_name', 'GPUtil.gpu.name')
                gpu_static['vram_total'] = make_sensor(round(gpu.memoryTotal, 1), 'MB', 'gpu_vram_total', 'GPUtil.gpu.memoryTotal')
        except:
            pass

    if not gpu_static and platform.system() == 'Windows':
        # Try gpu-reader.exe
        win_static = collect_gpu_windows_native_static()
        if win_static:
            gpu_static = win_static

    # Memory static
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    memory_static = {
        'total': make_sensor(round(mem.total / 1024 / 1024, 1), 'MB', 'memory_total', 'psutil.virtual_memory().total'),
        'swap_total': make_sensor(round(swap.total / 1024 / 1024, 1), 'MB', 'memory_swap_total', 'psutil.swap_memory().total'),
    }

    # Disk static
    if platform.system() == 'Windows':
        disk = psutil.disk_usage('C:\\')
    else:
        disk = psutil.disk_usage('/')
    disk_static = {
        'total': make_sensor(round(disk.total / 1024 / 1024 / 1024, 1), 'GB', 'disk_total', 'psutil.disk_usage().total'),
    }

    _static_cache = {
        'system': {
            'hostname': make_sensor(socket.gethostname(), 'text', 'system_hostname', 'socket.gethostname()'),
            'platform': make_sensor(platform.system(), 'text', 'system_platform', 'platform.system()'),
        },
        'cpu': cpu_static,
        'gpu': gpu_static,
        'memory': memory_static,
        'disk': disk_static,
    }

    return _static_cache


def collect_all():
    """Collect all metrics and return as dict.

    Uses cached static data (gpu_name, cpu_name, etc.) merged with
    fresh dynamic data (usage, temps, etc.) for optimal performance.
    """
    # Get cached static data (only queried once at startup)
    static = collect_static()

    # System: static (hostname, platform) + dynamic (uptime)
    system = dict(static.get('system', {}))
    system['uptime'] = make_sensor(int(psutil.boot_time()), 'seconds', 'system_uptime', 'psutil.boot_time()')

    # CPU: static (name, cores, threads) + dynamic (usage, freq, temp)
    cpu = dict(static.get('cpu', {}))
    cpu['usage_total'] = make_sensor(round(psutil.cpu_percent(interval=None), 1), '%', 'cpu_usage_total', 'psutil.cpu_percent()')
    freq = psutil.cpu_freq()
    if freq:
        cpu['frequency'] = make_sensor(round(freq.current, 1), 'MHz', 'cpu_frequency', 'psutil.cpu_freq().current')
    try:
        temps = psutil.sensors_temperatures()
        if temps:
            if 'coretemp' in temps:
                core_temps = [t.current for t in temps['coretemp'] if 'Core' in t.label]
                if core_temps:
                    cpu['temperature'] = make_sensor(round(sum(core_temps) / len(core_temps), 1), '°C', 'cpu_temperature', 'psutil.sensors_temperatures()[coretemp]')
            elif 'cpu_thermal' in temps:
                cpu['temperature'] = make_sensor(round(temps['cpu_thermal'][0].current, 1), '°C', 'cpu_temperature', 'psutil.sensors_temperatures()[cpu_thermal]')
    except:
        pass

    # GPU: static (name, vram_total) + dynamic (usage, temp, vram_used, etc.)
    gpu_static = static.get('gpu', {})
    gpu_dynamic = collect_gpu()
    gpu = dict(gpu_dynamic)
    if gpu_static.get('name'):
        gpu['name'] = gpu_static['name']
    if gpu_static.get('vram_total'):
        gpu['vram_total'] = gpu_static['vram_total']

    # Memory: static (total, swap_total) + dynamic (used, available, usage_percent, swap_used)
    memory = dict(static.get('memory', {}))
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    memory['used'] = make_sensor(round(mem.used / 1024 / 1024, 1), 'MB', 'memory_used', 'psutil.virtual_memory().used')
    memory['available'] = make_sensor(round(mem.available / 1024 / 1024, 1), 'MB', 'memory_available', 'psutil.virtual_memory().available')
    memory['usage_percent'] = make_sensor(round(mem.percent, 1), '%', 'memory_usage_percent', 'psutil.virtual_memory().percent')
    memory['swap_used'] = make_sensor(round(swap.used / 1024 / 1024, 1), 'MB', 'memory_swap_used', 'psutil.swap_memory().used')

    # Disk: static (total) + dynamic (used, free, usage_percent, speeds)
    disk = dict(static.get('disk', {}))
    if platform.system() == 'Windows':
        disk_usage = psutil.disk_usage('C:\\')
    else:
        disk_usage = psutil.disk_usage('/')
    disk['used'] = make_sensor(round(disk_usage.used / 1024 / 1024 / 1024, 1), 'GB', 'disk_used', 'psutil.disk_usage().used')
    disk['free'] = make_sensor(round(disk_usage.free / 1024 / 1024 / 1024, 1), 'GB', 'disk_free', 'psutil.disk_usage().free')
    disk['usage_percent'] = make_sensor(round(disk_usage.percent, 1), '%', 'disk_usage_percent', 'psutil.disk_usage().percent')
    io = psutil.disk_io_counters()
    if io:
        disk['read_speed'] = make_sensor(0, 'MB/s', 'disk_read_speed', 'delta(bytes_read) / time', 'calculated')
        disk['write_speed'] = make_sensor(0, 'MB/s', 'disk_write_speed', 'delta(bytes_written) / time', 'calculated')

    return {
        'system': system,
        'cpu': cpu,
        'gpu': gpu,
        'memory': memory,
        'disk': disk,
        'network': collect_network(),
        'battery': collect_battery(),
        'cores': collect_cores()
    }


def collect_all_raw():
    """Collect ALL raw metrics including unmapped sensors (for 'Show All' mode)."""
    return {
        'system': collect_system(),
        'cpu': collect_cpu(),
        'gpu': collect_gpu(),
        'memory': collect_memory(),
        'disk': collect_disk(),
        'network': collect_network(),
        'battery': collect_battery(),
        'cores': collect_cores()
    }


def main():
    """Run as persistent daemon, reading commands from stdin."""
    # Initialize CPU tracking once at startup
    psutil.cpu_percent(interval=None, percpu=True)

    # Signal ready
    print(json.dumps({'status': 'ready'}), flush=True)

    # Main loop - read commands from stdin
    for line in sys.stdin:
        line = line.strip()

        if line == 'collect':
            try:
                metrics = collect_all()
                print(json.dumps(metrics), flush=True)
            except Exception as e:
                print(json.dumps({'error': str(e)}), flush=True)

        elif line == 'collect_all_raw':
            try:
                metrics = collect_all_raw()
                print(json.dumps(metrics), flush=True)
            except Exception as e:
                print(json.dumps({'error': str(e)}), flush=True)

        elif line == 'clear_cache':
            clear_static_cache()
            print(json.dumps({'status': 'cache_cleared'}), flush=True)

        elif line == 'exit':
            break

        # Ignore empty lines or unknown commands


if __name__ == '__main__':
    main()
