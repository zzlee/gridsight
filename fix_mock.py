import sys
import re

with open("tools/mock_agents.py", "r") as f:
    content = f.read()

# Fix f-string literals with explicit \r\n (instead of actual newlines)
def fix_push_single_snapshot(match):
    return """async def push_single_snapshot(teacher_ip: str, teacher_port: int, agent: MockAgent):
    \"\"\"Sends a single HTTP POST snapshot asynchronously via raw TCP socket.\"\"\"
    try:
        if not agent.token:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(1.0)
            sock.bind(("0.0.0.0", 0))
            payload = json.dumps({"type": "BEACON", "mac": agent.mac, "hostname": agent.hostname, "ip": agent.ip}).encode("utf-8")
            sock.sendto(payload, ("127.0.0.1", 8888))
            try:
                data, _ = sock.recvfrom(4096)
                agent.token = json.loads(data.decode("utf-8")).get("token", "")
            except:
                pass
            finally:
                sock.close()

        reader, writer = await asyncio.open_connection(teacher_ip, teacher_port)
        req_headers = (
            f"POST /api/agent/snapshot HTTP/1.1\\r\\n"
            f"Host: {teacher_ip}:{teacher_port}\\r\\n"
            f"Content-Type: image/jpeg\\r\\n"
            f"x-agent-mac: {agent.mac}\\r\\n"
            f"x-agent-ip: {agent.ip}\\r\\n"
            f"x-agent-hostname: {agent.hostname}\\r\\n"
            f"x-auth-token: {agent.token}\\r\\n"
            f"Content-Length: {len(agent.jpeg_cache)}\\r\\n"
            f"Connection: close\\r\\n"
            f"\\r\\n"
        ).encode('utf-8')
        writer.write(req_headers + agent.jpeg_cache)
        await writer.drain()
        writer.close()
        await writer.wait_closed()
    except Exception as e:
        pass"""

content = re.sub(r'async def push_single_snapshot\(.*?\n    except Exception as e:\n        pass', fix_push_single_snapshot, content, flags=re.DOTALL)


with open("tools/mock_agents.py", "w") as f:
    f.write(content)
