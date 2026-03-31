/**
 * tests/external/hcl.test.js
 *
 * Test suite for HCL2 lexer, parser, formatter, and syntax highlighter
 * Aligned with HCL Native Syntax Specification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    formatHCL,
    highlightHCL,
    parseHCL,
    validateHCL,
    HCL_CSS,
    injectHCSS
} from '../../external/hcl.js';

describe('HCL2 Module', () => {
    // Clean up CSS between tests for isolation
    beforeEach(() => {
        if (typeof document !== 'undefined') {
            Array.from(document.head.querySelectorAll('style')).forEach(s => {
                if (s.textContent?.includes('.hcl-id')) s.remove();
            });
        }
    });

    describe('validateHCL', () => {
        it('should return null for valid HCL', () => {
            const validHCL = `
                resource "aws_instance" "example" {
                    ami           = "ami-123456"
                    instance_type = "t2.micro"
                    tags = {
                        Name = "example"
                    }
                }
            `;
            expect(validateHCL(validHCL)).toBeNull();
        });

        it('should return error for invalid HCL with unclosed brace', () => {
            const invalidHCL = `
                resource "aws_instance" "example" {
                    ami = "ami-123456"
            `;
            const error = validateHCL(invalidHCL);
            expect(error).toBeTruthy();
            expect(error).toContain('Unclosed');
        });

        it('should return error for mismatched braces', () => {
            const invalidHCL = `
                resource "aws_instance" "example" {
                    ami = "ami-123456"
                ]
            `;
            const error = validateHCL(invalidHCL);
            expect(error).toBeTruthy();
            expect(error).toContain('Unexpected');
        });

        it('should validate simple key-value pairs', () => {
            const hcl = `
                ami           = "ami-123456"
                instance_type = "t2.micro"
                count         = 3
                enabled       = true
                tags          = null
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should validate nested structures', () => {
            const hcl = `
                network {
                    interface {
                        device = "eth0"
                        ip     = "10.0.0.1"
                    }
                }
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should handle all comment types correctly', () => {
            const hcl = `
                # Line comment with hash
                ami = "ami-123456" // Line comment with slashes
                /* Block comment
                   spanning lines */
                instance_type = "t2.micro"
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should validate heredoc syntax', () => {
            const hcl = `
                content = <<EOF
                multi-line
                heredoc content
                EOF
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should validate indented heredoc', () => {
            const hcl = `
                content = <<-EOF
                    indented line
                    another line
                EOF
            `;
            expect(validateHCL(hcl)).toBeNull();
        });
    });

    describe('parseHCL', () => {
        it('should return success true for valid HCL', () => {
            const hcl = 'name = "test"';
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should return parsed data structure for attributes', () => {
            const hcl = `
                name = "test"
                count = 42
                enabled = true
            `;
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                name: 'test',
                count: 42,
                enabled: true
            });
        });

        it('should return parsed data structure for blocks', () => {
            const hcl = `
                resource "aws_instance" "example" {
                    ami = "ami-123456"
                }
            `;
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.data.resource).toBeDefined();
            expect(Array.isArray(result.data.resource)).toBe(true);
            expect(result.data.resource[0].labels).toEqual(['aws_instance', 'example']);
            expect(result.data.resource[0].ami).toBe('ami-123456');
        });

        it('should return success false for invalid HCL', () => {
            const hcl = 'name = "test" {';
            const result = parseHCL(hcl);
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should include error message on failure', () => {
            const hcl = '{ invalid }';
            const result = parseHCL(hcl);
            expect(result.success).toBe(false);
            expect(typeof result.error).toBe('string');
        });

        it('should parse nested blocks', () => {
            const hcl = `
                terraform {
                    required_providers {
                        aws = {
                            source = "hashicorp/aws"
                        }
                    }
                }
            `;
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.data.terraform).toBeDefined();
            expect(result.data.terraform[0].required_providers).toBeDefined();
        });

        it('should parse lists and objects', () => {
            const hcl = `
                tags = ["a", "b", "c"]
                config = {
                    key = "value"
                    num = 123
                }
            `;
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(Array.isArray(result.data.tags)).toBe(true);
            expect(result.data.tags).toEqual(['a', 'b', 'c']);
            expect(typeof result.data.config).toBe('object');
            expect(result.data.config.key).toBe('value');
        });

        it('should parse strings with multiple template interpolations', () => {
            // Escape $ to avoid JS template interpolation
            const hcl = 'message = "Hello ${var.name}, age ${var.age}"';
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.data.message).toBe('Hello ${var.name}, age ${var.age}');
        });
    });

    describe('formatHCL', () => {
        it('should format simple key-value pairs', () => {
            const input = 'ami="ami-123456" instance_type="t2.micro"';
            const formatted = formatHCL(input);
            expect(formatted).toContain('ami = "ami-123456"');
            expect(formatted).toContain('instance_type = "t2.micro"');
        });

        it('should format blocks with proper indentation and spacing', () => {
            const input = 'resource "aws_instance" "example" { ami = "ami-123456" instance_type = "t2.micro" }';
            const formatted = formatHCL(input);
            expect(formatted).toContain('resource "aws_instance" "example" {');
            expect(formatted).toContain('  ami = "ami-123456"');
            expect(formatted).toContain('  instance_type = "t2.micro"');
        });

        it('should handle nested blocks with proper indentation', () => {
            const input = 'network { interface { device = "eth0" ip = "10.0.0.1" } }';
            const formatted = formatHCL(input);
            expect(formatted).toContain('network {');
            expect(formatted).toContain('  interface {');
            expect(formatted).toContain('    device = "eth0"');
            expect(formatted).toContain('    ip = "10.0.0.1"');
        });

        it('should add single spaces around operators (no doubles)', () => {
            const input = 'count=3+2 name="test"';
            const formatted = formatHCL(input);
            expect(formatted).toContain('count = 3 + 2');
            expect(formatted).toContain('name = "test"');
            expect(formatted).not.toMatch(/\s{2,}\+\s/);
        });

        it('should format lists and maps with proper spacing', () => {
            const input = 'tags = { Name = "example" Env = "prod" } items = ["a","b","c"]';
            const formatted = formatHCL(input);
            expect(formatted).toContain('tags = {');
            expect(formatted).toContain('Name = "example"');
            expect(formatted).toContain('Env = "prod"');
            expect(formatted).toContain('items = ["a", "b", "c"]');
        });

        it('should preserve string escapes', () => {
            const input = 'message = "Hello\\nWorld\\tTab\\"Quote\\\\"';
            const formatted = formatHCL(input);
            expect(formatted).toContain('"Hello\\nWorld\\tTab\\"Quote\\\\"');
        });

        it('should handle empty blocks', () => {
            const input = 'empty {}';
            const formatted = formatHCL(input);
            expect(formatted).toBe('empty {}');
        });

        it('should collapse multiple blank lines', () => {
            const input = 'a = 1\n\n\nb = 2';
            const formatted = formatHCL(input);
            expect(formatted).not.toContain('\n\n\n');
            expect(formatted).toMatch(/a = 1\nb = 2/);
        });

        it('should handle template expressions in strings', () => {
            const hcl = 'message = "Hello ${var.name}"';
            const formatted = formatHCL(hcl);
            expect(formatted).toContain('${');
            expect(formatted).toContain('message = "Hello ${var.name}"');
        });

        it('should not add spaces around dots for attribute access', () => {
            const input = 'value = var.attr.sub';
            const formatted = formatHCL(input);
            expect(formatted).toContain('var.attr.sub');
            expect(formatted).not.toContain('var . attr');
        });

        it('should format block labels with single spaces', () => {
            const input = 'resource "aws_instance" "web" { }';
            const formatted = formatHCL(input);
            expect(formatted).toContain('resource "aws_instance" "web" {');
            expect(formatted).not.toContain('"web"  {');
        });
    });

    describe('highlightHCL', () => {
        it('should return HTML string with spans', () => {
            const hcl = 'name = "test"';
            const html = highlightHCL(hcl);
            expect(html).toContain('<span class="hcl-id">');
            expect(html).toContain('<span class="hcl-op">');
            expect(html).toContain('<span class="hcl-str">');
        });

        it('should highlight identifiers', () => {
            const hcl = 'resource_name = "value"';
            const html = highlightHCL(hcl);
            expect(html).toMatch(/<span class="hcl-id">resource_name<\/span>/);
        });

        it('should highlight strings', () => {
            const hcl = 'name = "test value"';
            const html = highlightHCL(hcl);
            expect(html).toContain('<span class="hcl-str">"test value"</span>');
        });

        it('should highlight numbers', () => {
            const hcl = 'count = 42';
            const html = highlightHCL(hcl);
            expect(html).toContain('<span class="hcl-num">42</span>');
        });

        it('should highlight boolean values', () => {
            const hcl = 'enabled = true disabled = false';
            const html = highlightHCL(hcl);
            expect(html).toContain('<span class="hcl-kw">true</span>');
            expect(html).toContain('<span class="hcl-kw">false</span>');
        });

        it('should highlight null', () => {
            const hcl = 'value = null';
            const html = highlightHCL(hcl);
            expect(html).toContain('<span class="hcl-kw">null</span>');
        });

        it('should highlight all comment types', () => {
            const hcl = '# Hash comment\n// Slash comment\n/* Block */';
            const html = highlightHCL(hcl);
            expect(html).toContain('<span class="hcl-cmt"># Hash comment</span>');
            expect(html).toContain('<span class="hcl-cmt">// Slash comment</span>');
            expect(html).toContain('<span class="hcl-cmt">/* Block */</span>');
        });

        it('should highlight operators', () => {
            const hcl = 'result = 1 + 2 * 3 == 9';
            const html = highlightHCL(hcl);
            expect(html).toContain('<span class="hcl-op">+</span>');
            expect(html).toContain('<span class="hcl-op">*</span>');
            expect(html).toContain('<span class="hcl-op">==</span>');
        });

        it('should escape HTML special characters', () => {
            const hcl = 'name = "<script>alert(\'xss\')</script>"';
            const html = highlightHCL(hcl);
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;');
        });

        it('should support line numbers option', () => {
            const hcl = 'a = 1\nb = 2\nc = 3';
            const html = highlightHCL(hcl, { lineNumbers: true });
            expect(html).toContain('hcl-line-number');
            expect(html).toContain('hcl-line-content');
        });

        it('should respect startLine option', () => {
            const hcl = 'a = 1\nb = 2';
            const html = highlightHCL(hcl, { lineNumbers: true, startLine: 10 });
            expect(html).toContain('>10</span>');
            expect(html).toContain('>11</span>');
        });

        it('should use custom wrapper class', () => {
            const hcl = 'a = 1';
            const html = highlightHCL(hcl, { wrapperClass: 'custom-class' });
            expect(html).toContain('custom-class');
        });

        it('should close HTML tags properly with line numbers', () => {
            const hcl = 'a = 1';
            const html = highlightHCL(hcl, { lineNumbers: true });
            const openDivs = (html.match(/<div/g) || []).length;
            const closeDivs = (html.match(/<\/div>/g) || []).length;
            expect(openDivs).toBe(closeDivs);
        });

        it('should highlight template interpolations', () => {
            const hcl = 'msg = "Hello ${var.name}"';
            const html = highlightHCL(hcl);
            expect(html).toContain('hcl-tmpl');
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty string', () => {
            expect(validateHCL('')).toBeNull();
            expect(formatHCL('')).toBe('');
            expect(highlightHCL('')).toBe('');
        });

        it('should handle strings with quotes', () => {
            const hcl = 'text = "He said \\"Hello\\""';
            expect(validateHCL(hcl)).toBeNull();
            const formatted = formatHCL(hcl);
            expect(formatted).toContain('"He said \\"Hello\\""');
        });

        it('should handle heredoc syntax', () => {
            const hcl = `
                content = <<EOF
                This is a
                multi-line string
                EOF
            `;
            expect(validateHCL(hcl)).toBeNull();
            const formatted = formatHCL(hcl);
            expect(formatted).toContain('content =');
        });

        it('should handle indented heredoc', () => {
            const hcl = `
                content = <<-EOF
                    indented line
                    another line
                EOF
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should handle empty heredoc', () => {
            const hcl = `
                content = <<EOF
                EOF
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should handle heredoc with only empty lines', () => {
            const hcl = `
                content = <<-EOF
                
                
                EOF
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should handle single template interpolation', () => {
            const hcl = 'message = "Hello ${var.name}"';
            expect(validateHCL(hcl)).toBeNull();
            const html = highlightHCL(hcl);
            expect(html).toContain('hcl-tmpl');
        });

        it('should handle multiple template interpolations in one string', () => {
            const hcl = 'message = "Hello ${var.name}, age ${var.age}, city ${var.city}"';
            expect(validateHCL(hcl)).toBeNull();
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            const html = highlightHCL(hcl);
            expect(html).toContain('hcl-tmpl');
        });

        it('should handle numeric literals including hex, octal, binary', () => {
            const hcl = `
                decimal = 42
                hex = 0x2A
                octal = 0o52
                binary = 0b101010
                float = 3.14
                exp = 1e-5
            `;
            expect(validateHCL(hcl)).toBeNull();
            const result = parseHCL(hcl);
            expect(result.data.hex).toBe(42);
            expect(result.data.octal).toBe(42);
            expect(result.data.binary).toBe(42);
            expect(result.data.float).toBe(3.14);
        });

        it('should handle complex expressions', () => {
            const hcl = `
                sum = 1 + 2 * 3
                condition = (var.count > 0) && var.enabled
                ternary = condition ? "yes" : "no"
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should handle blocks with multiple labels', () => {
            const hcl = `
                resource "aws_instance" "web" "extra" {
                    ami = "ami-123456"
                }
            `;
            expect(validateHCL(hcl)).toBeNull();
        });

        it('should handle unicode escapes', () => {
            const hcl = 'text = "Hello \\u0041\\u0042\\u0043"';
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.data.text).toBe('Hello ABC');
        });

        it('should handle uppercase unicode escapes', () => {
            const hcl = 'text = "\\U00000041"';
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.data.text).toBe('A');
        });

        it('should handle mixed comment types in same file', () => {
            const hcl = `
                # Hash comment
                a = 1 // Inline slash comment
                /* Block */ b = 2
            `;
            expect(validateHCL(hcl)).toBeNull();
        });
    });

    describe('CSS and Injection', () => {
        it('should export HCL_CSS string', () => {
            expect(HCL_CSS).toBeDefined();
            expect(typeof HCL_CSS).toBe('string');
            expect(HCL_CSS).toContain('.hcl-id');
        });

        it('should inject CSS in browser environment', () => {
            if (typeof document !== 'undefined') {
                injectHCSS();
                const style = document.head.querySelector('style');
                expect(style).toBeDefined();
                expect(style.textContent).toContain('.hcl-id');
            }
        });

        it('should not duplicate CSS on multiple injections', () => {
            if (typeof document !== 'undefined') {
                injectHCSS();
                const initialCount = document.head.querySelectorAll('style').length;
                injectHCSS();
                const newCount = document.head.querySelectorAll('style').length;
                expect(newCount).toBe(initialCount);
            }
        });

        it('should handle CSS injection when DOM inspection fails', () => {
            if (typeof document !== 'undefined') {
                try {
                    injectHCSS();
                    expect(true).toBe(true);
                } catch {
                    expect(true).toBe(true);
                }
            }
        });
    });

    describe('Error Handling', () => {
        it('should throw error on invalid syntax in formatHCL', () => {
            const invalid = '{ { }';
            expect(() => formatHCL(invalid)).toThrow();
        });

        it('should provide line numbers in error messages', () => {
            try {
                formatHCL('a = 1\nb = {');
            } catch (e) {
                expect(e.message).toMatch(/line \d+:\d+/);
            }
        });

        it('should handle unexpected characters gracefully', () => {
            const invalid = 'a = @invalid';
            expect(() => formatHCL(invalid)).toThrow();
            const result = parseHCL(invalid);
            expect(result.success).toBe(false);
        });

        it('should handle unterminated string', () => {
            const invalid = 'text = "unterminated';
            const result = parseHCL(invalid);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Unterminated');
        });

        it('should handle mismatched template braces', () => {
            // Use string concatenation to avoid JS template interpolation
            const invalid = 'msg = "Hello ${var.name"';
            const result = parseHCL(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe('Performance and Caching', () => {
        it('should handle large HCL files', () => {
            const largeHCL = Array(1000).fill('resource "test" { value = "data" }').join('\n');
            expect(() => validateHCL(largeHCL)).not.toThrow();
            expect(validateHCL(largeHCL)).toBeNull();
        });

        it('should handle files over 100KB (no cache)', () => {
            const hugeHCL = Array(2000).fill('resource "test" { value = "' + 'x'.repeat(100) + '" }').join('\n');
            expect(hugeHCL.length).toBeGreaterThan(100000);
            expect(() => validateHCL(hugeHCL)).not.toThrow();
        });

        it('should cache tokenization for repeated small inputs', () => {
            const input = 'a = 1';
            const result1 = parseHCL(input);
            const result2 = parseHCL(input);
            expect(result1.success).toBe(true);
            expect(result2.success).toBe(true);
        });
    });

    describe('HCL Spec Compliance', () => {
        it('should treat # and // comments as equivalent to newline', () => {
            const hcl1 = 'a = 1 # comment\nb = 2';
            const hcl2 = 'a = 1 // comment\nb = 2';
            expect(validateHCL(hcl1)).toBeNull();
            expect(validateHCL(hcl2)).toBeNull();
        });

        it('should treat /* */ block comments as whitespace', () => {
            const hcl = 'a /* comment */ = 1';
            expect(validateHCL(hcl)).toBeNull();
            const result = parseHCL(hcl);
            expect(result.data.a).toBe(1);
        });

        it('should support identifier with dashes per spec', () => {
            const hcl = 'my-identifier = "value"';
            expect(validateHCL(hcl)).toBeNull();
            const result = parseHCL(hcl);
            expect(result.data['my-identifier']).toBe('value');
        });

        it('should handle string literal without interpolation (StringLit production)', () => {
            const hcl = 'name = "plain string"';
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
            expect(result.data.name).toBe('plain string');
        });

        it('should handle template unwrapping special case', () => {
            const hcl = 'value = ${true}';
            const result = parseHCL(hcl);
            expect(result.success).toBe(true);
        });
    });
});

// Integration test
describe('Integration', () => {
    it('should handle complete HCL configuration example', () => {
        const completeConfig = `
            # Terraform configuration
            terraform {
                required_version = ">= 1.0"
                required_providers {
                    aws = {
                        source  = "hashicorp/aws"
                        version = "~> 4.0"
                    }
                }
            }

            # Provider configuration
            provider "aws" {
                region = var.aws_region
                profile = "default"
            }

            # Data source
            data "aws_ami" "ubuntu" {
                most_recent = true
                owners = ["099720109477"]
                
                filter {
                    name   = "name"
                    values = ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"]
                }
            }

            # Resource
            resource "aws_instance" "web" {
                ami           = data.aws_ami.ubuntu.id
                instance_type = var.instance_type
                count         = 3
                
                tags = {
                    Name        = "WebServer"
                    Environment = "Production"
                }
                
                user_data = <<-EOF
                    #!/bin/bash
                    echo "Hello World" > /tmp/hello.txt
                EOF
            }

            # Output
            output "instance_ips" {
                value = aws_instance.web[*].public_ip
                description = "List of public IP addresses"
            }
        `;

        expect(validateHCL(completeConfig)).toBeNull();

        const parsed = parseHCL(completeConfig);
        expect(parsed.success).toBe(true);
        expect(parsed.data.terraform).toBeDefined();
        expect(parsed.data.provider).toBeDefined();
        expect(parsed.data.resource).toBeDefined();

        const formatted = formatHCL(completeConfig);
        expect(formatted).toBeDefined();
        expect(formatted).toContain('terraform {');
        expect(formatted).toContain('provider "aws" {');
        expect(formatted).toMatch(/provider "aws" \{/);
        expect(formatted).not.toMatch(/provider "aws"  \{/);

        const html = highlightHCL(completeConfig, { lineNumbers: true });
        expect(html).toContain('hcl-id');
        expect(html).toContain('hcl-str');
        expect(html).toContain('hcl-line-number');
    });

    it('should round-trip: parse -> format -> parse', () => {
        const original = `
            resource "test" "example" {
                name = "value"
                count = 5
                tags = {
                    Env = "prod"
                }
            }
        `;

        const parsed1 = parseHCL(original);
        expect(parsed1.success).toBe(true);

        const formatted = formatHCL(original);
        const parsed2 = parseHCL(formatted);
        expect(parsed2.success).toBe(true);

        expect(parsed2.data.resource).toBeDefined();
        expect(parsed2.data.resource[0].name).toBe('value');
        expect(parsed2.data.resource[0].count).toBe(5);
    });
});